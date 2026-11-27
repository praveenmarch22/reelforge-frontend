import {act, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {RENDER_POLL_MS} from '@/api/publishing';
import type {Project, Render} from '@/api/types';
import {apiError, credits, installFakeApi, job, project, scene, user, withBasics, type FakeApi} from '@/test/fakeApi';
import {aRender, aVideo, CHANNEL, openAt} from '@/test/f7';
import {PublishPage} from './PublishPage';
import {RenderPage} from './RenderPage';

// Screen 12, render progress (docs/SCREENS_F7.md section 2; API E1-E3, G3). Fake `fetch`.

let api: FakeApi;
let current: Project;
let renders: Render[];

function setup(over: Partial<Project> = {}, history: Render[] = [], renderCost = 2) {
  api = installFakeApi();
  current = project({status: 'rendered', scenes: [scene(1)], ...over});
  renders = history;
  withBasics(api, {me: user({connections: {youtube: CHANNEL, instagram: null}})});
  const info = credits(99);
  info.costs.render = renderCost;
  api.on('GET /credits', () => ({body: info}));
  api.on('GET /projects/:id', () => ({body: {project: current}}));
  api.on('GET /projects/:id/renders', () => ({body: {items: renders}}));
}

const open = () =>
  openAt('/app/p/p1/render', [
    {path: '/app/p/:id/render', element: <RenderPage />},
    {path: '/app/p/:id/publish', element: <PublishPage />},
  ]);

const started = (id = 'r9') => ({
  status: 202,
  body: {render: aRender({id, state: 'queued', progress: 0, video: null, thumbnailUrl: null}), job: job({id: 'j9', type: 'render'}), creditsReserved: 2, balance: 97},
});

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Render page: each state', () => {
  it('no render yet: says so and links back to the editor, without calling E1', async () => {
    setup({status: 'ready', latestRender: null});
    open();
    expect(await screen.findByText("This Reel hasn't been rendered yet")).toBeInTheDocument();
    expect(screen.getByText(/press render in the editor/i)).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Open the editor'})).toHaveAttribute('href', '/app/p/p1/edit');
    expect(screen.getByRole('link', {name: 'Back to the editor'})).toHaveAttribute('href', '/app/p/p1/edit');
    expect(api.calls('POST /projects/:id/render')).toHaveLength(0);
  });

  it('shows the steps header with Publish', async () => {
    setup({status: 'ready', latestRender: null});
    open();
    const steps = await screen.findByRole('list', {name: 'Steps'});
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Publish')]),
    );
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
  });

  it('queued: "Waiting for the renderer", 0 %, the leave-the-page note and the placeholder', async () => {
    const queued = aRender({state: 'queued', progress: 0, video: null, thumbnailUrl: null});
    setup({status: 'rendering', latestRender: queued}, [queued]);
    api.on('GET /renders/:id', () => ({body: {render: queued}}));
    open();
    expect(await screen.findByRole('heading', {name: 'Waiting for the renderer'})).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name: 'Render progress'})).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('Your video is being made')).toBeInTheDocument();
    expect(screen.getByText(/you can leave this page; the render carries on/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /publish/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: /download/i})).not.toBeInTheDocument();
  });

  it('running: polls E2 every 3 s, the bar follows it, the announcement moves in steps of 10 %, then the video shows', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    const running = aRender({state: 'running', progress: 12, video: null, thumbnailUrl: null});
    setup({status: 'rendering', latestRender: running}, [running]);
    let e2 = {...running, progress: 12};
    api.on('GET /renders/:id', () => ({body: {render: e2}}));
    open();
    const bar = await screen.findByRole('progressbar', {name: 'Render progress'});
    expect(screen.getByRole('heading', {name: 'Rendering'})).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /renders/:id').length).toBeGreaterThan(0));
    expect(api.calls('GET /renders/:id')[0].path).toBe('/renders/r1');

    e2 = {...running, progress: 47};
    const before = api.calls('GET /renders/:id').length;
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '47'));
    expect(api.calls('GET /renders/:id').length).toBe(before + 1);
    // The live text moves in steps of 10 %, so a screen reader isn't flooded.
    const live = screen.getByText('40%');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');

    e2 = aRender({id: 'r1'});
    renders = [e2];
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    expect(await screen.findByRole('heading', {name: 'Your video is ready'})).toBeInTheDocument();
    expect(screen.getByLabelText(/rendered video/i)).toHaveAttribute('src', '/media/r1.mp4');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    // Polling E2 stops once the render has finished.
    const after = api.calls('GET /renders/:id').length;
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS * 3));
    expect(api.calls('GET /renders/:id').length).toBe(after);
  });

  it('the outcome heading is a polite live region', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    open();
    const h = await screen.findByRole('heading', {name: 'Your video is ready'});
    expect(h).toHaveAttribute('aria-live', 'polite');
  });

  it('succeeded: the video with its poster, length and size, Download and Publish', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    open();
    expect(await screen.findByRole('heading', {name: 'Your video is ready'})).toBeInTheDocument();
    const video = screen.getByLabelText('Rendered video of Three morning habits');
    expect(video).toHaveAttribute('src', '/media/r1.mp4');
    expect(video).toHaveAttribute('poster', '/media/r1.jpeg');
    expect(screen.getByText('29 s · 11.4 MB')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /download/i})).toHaveAttribute('href', '/media/r1.mp4?download');
    expect(screen.queryByText(/you edited the reel after this render/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /render again/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /stop rendering/i})).not.toBeInTheDocument();
  });

  it('outdated: the note and Render again with the cost from H1, confirmed with the cost', async () => {
    const done = aRender({outdated: true});
    setup({latestRender: done}, [done], 3);
    api.on('POST /projects/:id/render', () => started());
    open();
    expect(await screen.findByText(/you edited the reel after this render/i)).toBeInTheDocument();
    const again = await screen.findByRole('button', {name: 'Render again · 3 credits'});
    expect(screen.getByRole('button', {name: /publish/i})).toBeInTheDocument(); // the old video can still be published
    await userEvent.click(again);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('3 credits'));
    await waitFor(() => expect(api.calls('POST /projects/:id/render')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/render')[0].headers['Idempotency-Key']).toBeTruthy();
  });

  it('Render again cancelled at the confirm sends nothing', async () => {
    const done = aRender({outdated: true});
    setup({latestRender: done}, [done]);
    vi.mocked(window.confirm).mockReturnValue(false);
    api.on('POST /projects/:id/render', () => started());
    open();
    await userEvent.click(await screen.findByRole('button', {name: /render again/i}));
    expect(window.confirm).toHaveBeenCalled();
    expect(api.calls('POST /projects/:id/render')).toHaveLength(0);
  });

  it('failed with no earlier video: the reason, credits given back, Try again with the cost', async () => {
    const failed = aRender({state: 'failed', progress: 60, video: null, thumbnailUrl: null, error: {code: 'render_failed', message: 'The renderer ran out of memory.'}});
    setup({status: 'render_failed', latestRender: failed}, [failed]);
    api.on('POST /projects/:id/render', () => started());
    open();
    expect(await screen.findByRole('heading', {name: 'Failed'})).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('The renderer ran out of memory. Your credits were given back.');
    expect(screen.queryByRole('button', {name: /^publish$/i})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Try again · 2 credits'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/render')).toHaveLength(1));
  });

  it('cancelled with no earlier video: "The render was stopped" and Try again', async () => {
    const stopped = aRender({state: 'cancelled', progress: 30, video: null, thumbnailUrl: null});
    setup({status: 'ready', latestRender: stopped}, [stopped]);
    open();
    expect(await screen.findByRole('heading', {name: 'Stopped'})).toBeInTheDocument();
    expect(await screen.findByText(/the render was stopped and its credits given back/i)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Try again · 2 credits'})).toBeEnabled();
    expect(screen.queryByRole('link', {name: /download/i})).not.toBeInTheDocument();
  });

  it('a failed render shows no outcome before the history has loaded (no failed-state flash)', async () => {
    const failed = aRender({state: 'failed', video: null, error: {code: 'render_failed', message: 'Boom.'}});
    setup({status: 'render_failed', latestRender: failed}, [failed]);
    let release = () => {};
    api.on('GET /projects/:id/renders', () => new Promise((r) => (release = () => r({body: {items: [aVideo('r0'), failed]}}))));
    open();
    await screen.findByRole('heading', {level: 1});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /try again|render again/i})).not.toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByRole('heading', {name: 'Your video is ready'})).toBeInTheDocument();
  });
});

describe('Render page: the newest finished video after a stopped or failed attempt', () => {
  it('after a failed attempt the earlier video stays shown, with Download and Publish, and the failure under it', async () => {
    const good = aVideo('r0');
    const failed = aRender({id: 'r1', state: 'failed', video: null, thumbnailUrl: null, error: {code: 'render_failed', message: 'The renderer crashed.'}});
    setup({status: 'render_failed', latestRender: failed}, [failed, good]);
    open();
    expect(await screen.findByRole('heading', {name: 'Your video is ready'})).toBeInTheDocument();
    expect(screen.getByLabelText(/rendered video/i)).toHaveAttribute('src', '/media/r0.mp4');
    expect(screen.getByRole('link', {name: /download/i})).toHaveAttribute('href', '/media/r0.mp4?download');
    expect(screen.getByRole('button', {name: /^publish$/i})).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your last render failed: The renderer crashed. Your credits were given back.');
    expect(screen.getByRole('button', {name: 'Render again · 2 credits'})).toBeInTheDocument();
    // Neither the earlier video nor the attempt is repeated under "Earlier renders".
    expect(screen.queryByText('Earlier renders')).not.toBeInTheDocument();
  });

  it('the publish page publishes that earlier video', async () => {
    const good = aVideo('r0');
    const stopped = aRender({id: 'r1', state: 'cancelled', video: null, thumbnailUrl: null});
    setup({status: 'rendered', latestRender: stopped}, [stopped, good]);
    open();
    await userEvent.click(await screen.findByRole('button', {name: /^publish$/i}));
    expect(await screen.findByLabelText('Video of Three morning habits')).toHaveAttribute('src', '/media/r0.mp4');
  });

  it('a newer render running keeps the progress on screen (not the earlier video)', async () => {
    const good = aVideo('r0');
    const running = aRender({id: 'r1', state: 'running', progress: 55, video: null, thumbnailUrl: null});
    setup({status: 'rendering', latestRender: running}, [running, good]);
    api.on('GET /renders/:id', () => ({body: {render: running}}));
    open();
    expect(await screen.findByRole('progressbar', {name: 'Render progress'})).toHaveAttribute('aria-valuenow', '55');
    expect(screen.getByRole('heading', {name: 'Rendering'})).toBeInTheDocument();
    expect(screen.queryByLabelText(/rendered video/i)).not.toBeInTheDocument();
  });
});

describe('Render page: history (E3)', () => {
  it('lists up to five earlier renders with time, state, length and Download for finished ones', async () => {
    const latest = aVideo('r9', {createdAt: '2026-11-26T12:00:00Z'});
    const older: Render[] = [
      aVideo('r8', {createdAt: '2026-11-26T11:00:00Z', video: {url: '/m/r8.mp4', downloadUrl: '/m/r8.mp4?download', durationSeconds: 31.6, sizeBytes: 1}}),
      aRender({id: 'r7', state: 'failed', video: null, thumbnailUrl: null, createdAt: '2026-11-26T10:00:00Z'}),
      aRender({id: 'r6', state: 'cancelled', video: null, thumbnailUrl: null, createdAt: '2026-11-26T09:00:00Z'}),
      aVideo('r5', {createdAt: '2026-11-26T08:00:00Z'}),
      aVideo('r4', {createdAt: '2026-11-26T07:00:00Z'}),
      aVideo('r3', {createdAt: '2026-11-26T06:00:00Z'}),
    ];
    setup({latestRender: latest}, [latest, ...older]);
    open();
    const title = await screen.findByRole('heading', {name: 'Earlier renders'});
    const list = within(title.parentElement!).getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent(/Ready · 32 s/);
    expect(within(items[0]).getByRole('link', {name: 'Download'})).toHaveAttribute('href', '/m/r8.mp4?download');
    expect(items[1]).toHaveTextContent('Failed');
    expect(within(items[1]).queryByRole('link')).not.toBeInTheDocument();
    expect(items[2]).toHaveTextContent('Stopped');
    expect(within(items[2]).queryByRole('link')).not.toBeInTheDocument();
    // The time is shown (day and month).
    expect(items[0].textContent).toMatch(/26/);
  });

  it('shows no history section when the only render is the one on screen', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    open();
    await screen.findByRole('heading', {name: 'Your video is ready'});
    expect(screen.queryByText('Earlier renders')).not.toBeInTheDocument();
  });
});

describe('Render page: Stop (G3)', () => {
  it('asks first; cancelling the confirm sends nothing', async () => {
    const running = aRender({state: 'running', progress: 20, video: null});
    setup({status: 'rendering', latestRender: running}, [running]);
    api.on('GET /renders/:id', () => ({body: {render: running}}));
    vi.mocked(window.confirm).mockReturnValue(false);
    open();
    await userEvent.click(await screen.findByRole('button', {name: /stop rendering/i}));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/credits are given back/i));
    expect(api.calls('POST /jobs/:id/cancel')).toHaveLength(0);
  });

  it("stops the render's job and then shows the stopped state", async () => {
    const running = aRender({state: 'running', progress: 20, video: null});
    setup({status: 'rendering', latestRender: running}, [running]);
    let e2 = running;
    api.on('GET /renders/:id', () => ({body: {render: e2}}));
    api.on('POST /jobs/:id/cancel', () => {
      e2 = {...running, state: 'cancelled'};
      current = {...current, status: 'ready', latestRender: e2};
      renders = [e2];
      return {body: {job: job({id: 'j-render', state: 'cancelled'})}};
    });
    open();
    await userEvent.click(await screen.findByRole('button', {name: /stop rendering/i}));
    await waitFor(() => expect(api.calls('POST /jobs/:id/cancel')).toHaveLength(1));
    expect(api.calls('POST /jobs/:id/cancel')[0].path).toBe('/jobs/j-render/cancel');
    expect(await screen.findByText(/the render was stopped and its credits given back/i)).toBeInTheDocument();
  });

  it('a refused stop says so', async () => {
    const running = aRender({state: 'running', progress: 20, video: null});
    setup({status: 'rendering', latestRender: running}, [running]);
    api.on('GET /renders/:id', () => ({body: {render: running}}));
    api.on('POST /jobs/:id/cancel', () => apiError(409, 'already_finished', 'This render has already finished.'));
    open();
    await userEvent.click(await screen.findByRole('button', {name: /stop rendering/i}));
    expect(await screen.findByRole('alert')).toHaveTextContent('This render has already finished.');
  });

  it('a render without a job has no Stop button', async () => {
    const running = aRender({state: 'queued', progress: 0, video: null, jobId: null});
    setup({status: 'rendering', latestRender: running}, [running]);
    api.on('GET /renders/:id', () => ({body: {render: running}}));
    open();
    await screen.findByRole('progressbar');
    expect(screen.queryByRole('button', {name: /stop rendering/i})).not.toBeInTheDocument();
  });
});

describe('Render page: starting again and its errors (E1)', () => {
  it('a started render shows its progress', async () => {
    const failed = aRender({state: 'failed', video: null, error: {code: 'render_failed', message: 'Boom.'}});
    setup({status: 'render_failed', latestRender: failed}, [failed]);
    const queued = started('r9').body.render;
    api.on('POST /projects/:id/render', () => {
      current = {...current, status: 'rendering', latestRender: queued};
      renders = [queued, failed];
      return started('r9');
    });
    api.on('GET /renders/:id', () => ({body: {render: queued}}));
    open();
    await userEvent.click(await screen.findByRole('button', {name: /try again/i}));
    expect(await screen.findByRole('heading', {name: 'Waiting for the renderer'})).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name: 'Render progress'})).toBeInTheDocument();
  });

  it('out of credits (402) shows the shared credit message', async () => {
    const failed = aRender({state: 'failed', video: null, error: {code: 'render_failed', message: 'Boom.'}});
    setup({status: 'render_failed', latestRender: failed}, [failed]);
    api.on('POST /projects/:id/render', () =>
      apiError(402, 'insufficient_credits', 'Not enough credits.', {needed: 2, balance: 1, resetsAt: '2026-12-01T00:00:00Z'}),
    );
    open();
    await userEvent.click(await screen.findByRole('button', {name: /try again/i}));
    expect(await screen.findByText(/This needs 2 credits and you have 1\. Your credits renew on/)).toBeInTheDocument();
  });

  it('another refusal shows its message', async () => {
    const done = aRender({outdated: true});
    setup({latestRender: done}, [done]);
    api.on('POST /projects/:id/render', () => apiError(409, 'already_running', 'Another of your Reels is rendering.'));
    open();
    await userEvent.click(await screen.findByRole('button', {name: /render again/i}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another of your Reels is rendering.');
  });

  it('each start sends a new Idempotency-Key', async () => {
    const done = aRender({outdated: true});
    setup({latestRender: done}, [done]);
    api.on('POST /projects/:id/render', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    open();
    const again = await screen.findByRole('button', {name: /render again/i});
    await userEvent.click(again);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', {name: /render again/i}));
    await waitFor(() => expect(api.calls('POST /projects/:id/render')).toHaveLength(2));
    const [a, b] = api.calls('POST /projects/:id/render');
    expect(a.headers['Idempotency-Key']).not.toBe(b.headers['Idempotency-Key']);
  });
});

describe('Render page: loading errors', () => {
  it('a missing Reel (404) goes to the projects list', async () => {
    setup();
    api.on('GET /projects/:id', () => apiError(404, 'not_found', 'Not found.'));
    open();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/app/projects'));
  });
});
