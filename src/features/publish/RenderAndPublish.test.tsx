import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Connection, Post, Project, Render} from '@/api/types';
import {apiError, installFakeApi, job, project, scene, user, withBasics, type FakeApi} from '@/test/fakeApi';
import {PublishPage} from './PublishPage';
import {RenderPage} from './RenderPage';

// F7 (docs/SCREENS_F7.md): render progress (screen 12), publish (13), "Your Short is live" (20) and
// the connect results (21–22), against a fake `fetch` (API E1–E3, F1, F4–F6, G1, G3).

let api: FakeApi;
let current: Project;

const CHANNEL: Connection = {status: 'connected', name: 'Asha Shorts', pictureUrl: null, connectedAt: null};

function aRender(over: Partial<Render> = {}): Render {
  return {
    id: 'r1',
    projectId: 'p1',
    jobId: 'j-render',
    state: 'succeeded',
    progress: 100,
    timelineVersion: 1,
    outdated: false,
    video: {url: '/media/r1.mp4', downloadUrl: '/media/r1.mp4?download', durationSeconds: 29.4, sizeBytes: 12_000_000},
    thumbnailUrl: '/media/r1.jpeg',
    error: null,
    createdAt: '2026-11-26T10:00:00Z',
    finishedAt: '2026-11-26T10:17:00Z',
    ...over,
  };
}

function aPost(over: Partial<Post> = {}): Post {
  return {
    id: 'post1',
    renderId: 'r1',
    projectId: 'p1',
    platform: 'youtube',
    state: 'queued',
    progress: 0,
    title: 'My Short',
    caption: '',
    visibility: 'public',
    credits: [],
    url: null,
    privateUntilVerified: false,
    error: null,
    createdAt: '2026-11-26T10:20:00Z',
    publishedAt: null,
    ...over,
  };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;
}

function open(path: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <Routes>
          <Route path="/app/p/:id/render" element={<RenderPage />} />
          <Route path="/app/p/:id/publish" element={<PublishPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setup(over: Partial<Project> = {}, renders: Render[] = [], youtube: Connection | null = CHANNEL) {
  api = installFakeApi();
  current = project({status: 'rendered', scenes: [scene(1)], ...over});
  withBasics(api, {me: user({connections: {youtube, instagram: null}})});
  api.on('GET /projects/:id', () => ({body: {project: current}}));
  api.on('GET /projects/:id/renders', () => ({body: {items: renders}}));
  api.on('PATCH /projects/:id', (req) => {
    current = {...current, ...req.body};
    return {body: {project: current, estimate: {credits: 0, balance: 99, items: []}}};
  });
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.restoreAllMocks());

describe('Render progress (screen 12)', () => {
  it('shows a running render with its progress, and stops it through its job', async () => {
    setup({status: 'rendering', latestRender: aRender({state: 'running', progress: 42, video: null})});
    api.on('POST /jobs/:id/cancel', () => ({body: {job: job({id: 'j-render', state: 'cancelled'})}}));
    open('/app/p/p1/render');
    expect(await screen.findByRole('progressbar', {name: 'Render progress'})).toHaveAttribute('aria-valuenow', '42');
    await userEvent.click(screen.getByRole('button', {name: /stop rendering/i}));
    await waitFor(() => expect(api.calls('POST /jobs/:id/cancel')).toHaveLength(1));
    expect(api.calls('POST /jobs/:id/cancel')[0].path).toBe('/jobs/j-render/cancel');
  });

  it('plays the finished video with Download and Publish', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    open('/app/p/p1/render');
    expect(await screen.findByRole('heading', {name: 'Your video is ready'})).toBeInTheDocument();
    expect(screen.getByLabelText(/rendered video/i)).toHaveAttribute('src', '/media/r1.mp4');
    expect(screen.getByText('29 s · 11.4 MB')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /download/i})).toHaveAttribute('href', '/media/r1.mp4?download');
    await userEvent.click(screen.getByRole('button', {name: /publish/i}));
    expect(await screen.findByRole('heading', {name: 'Publish'})).toBeInTheDocument();
  });

  it('after a stopped attempt keeps the earlier video and offers Render again', async () => {
    const good = aRender({id: 'r0'});
    const stopped = aRender({id: 'r1', state: 'cancelled', video: null, thumbnailUrl: null});
    setup({status: 'rendered', latestRender: stopped}, [stopped, good]);
    open('/app/p/p1/render');
    expect(await screen.findByRole('heading', {name: 'Your video is ready'})).toBeInTheDocument();
    expect(screen.getByText(/your last render was stopped/i)).toBeInTheDocument();
    api.on('POST /projects/:id/render', () => ({
      status: 202,
      body: {render: aRender({id: 'r2', state: 'queued', video: null}), job: job(), creditsReserved: 2, balance: 97},
    }));
    await userEvent.click(screen.getByRole('button', {name: /render again/i}));
    await waitFor(() => expect(api.calls('POST /projects/:id/render')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/render')[0].headers['Idempotency-Key']).toBeTruthy();
  });

  it('a failed render says why and that the credits came back', async () => {
    const failed = aRender({state: 'failed', video: null, error: {code: 'render_failed', message: "The video couldn't be made."}});
    setup({status: 'render_failed', latestRender: failed}, [failed]);
    open('/app/p/p1/render');
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be made.*credits were given back/i);
    expect(screen.getByRole('button', {name: /try again/i})).toBeEnabled();
  });
});

describe('Publish (screens 13 and 20)', () => {
  it('publishes with the title, description, hashtags and visibility, then follows the post to live', async () => {
    const done = aRender();
    setup({latestRender: done, postTitle: 'Ocean computers'}, [done]);
    let post = aPost({title: 'Ocean computers'});
    api.on('POST /renders/:id/publish', (req) => {
      post = {...post, title: req.body.title};
      return {status: 202, body: {post, job: job({type: 'publish'})}};
    });
    api.on('GET /posts/:id', () => ({body: {post}}));
    open('/app/p/p1/publish');

    expect((await screen.findAllByText('Asha Shorts')).length).toBeGreaterThan(0); // the top bar and the channel row
    expect(screen.getByLabelText(/title/i)).toHaveValue('Ocean computers');
    await userEvent.type(screen.getByLabelText(/description/i), 'Watch this.');
    await userEvent.type(screen.getByLabelText(/hashtags/i), '#shorts{Enter}facts,');
    await userEvent.click(screen.getByRole('button', {name: 'Unlisted'}));
    await userEvent.click(screen.getByRole('button', {name: /publish now/i}));

    await waitFor(() => expect(api.calls('POST /renders/:id/publish')).toHaveLength(1));
    const sent = api.calls('POST /renders/:id/publish')[0];
    expect(sent.path).toBe('/renders/r1/publish');
    expect(sent.body).toEqual({
      platform: 'youtube',
      title: 'Ocean computers',
      caption: 'Watch this.',
      hashtags: ['shorts', 'facts'],
      visibility: 'unlisted',
    });
    expect(sent.headers['Idempotency-Key']).toBeTruthy();
    expect(await screen.findByRole('heading', {name: 'Publishing to YouTube'})).toBeInTheDocument();

    post = {...post, state: 'published', progress: 100, url: 'https://youtube.com/shorts/abc', privateUntilVerified: true};
    expect(await screen.findByRole('heading', {name: 'Your Short is live'}, {timeout: 5000})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /open on youtube/i})).toHaveAttribute('href', 'https://youtube.com/shorts/abc');
    expect(screen.getByText(/kept it private until ReelForge is verified/i)).toBeInTheDocument();
  });

  it('without a channel asks to connect, and connecting goes to Google with this page to come back to', async () => {
    const done = aRender();
    setup({latestRender: done}, [done], null);
    api.on('GET /connections/:platform/connect', () => ({body: {authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1'}}));
    const assign = vi.fn();
    vi.stubGlobal('location', {...window.location, assign});
    open('/app/p/p1/publish');
    expect(await screen.findByRole('button', {name: /publish now/i})).toBeDisabled();
    await userEvent.click(screen.getByRole('button', {name: /connect youtube/i}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    expect(api.calls('GET /connections/:platform/connect')[0].path).toBe(
      `/connections/youtube/connect?returnTo=${encodeURIComponent('/app/p/p1/publish')}`,
    );
    vi.unstubAllGlobals();
  });

  it('refuses < and > before sending, and an outdated render needs a confirm', async () => {
    const done = aRender({outdated: true});
    setup({latestRender: done}, [done]);
    open('/app/p/p1/publish');
    const title = await screen.findByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Bad <title>');
    expect(screen.getByText('Remove the < and > characters')).toBeInTheDocument();
    await userEvent.clear(title);
    await userEvent.type(title, 'Good title');
    const publish = screen.getByRole('button', {name: /publish now/i});
    expect(publish).toBeDisabled(); // outdated, not confirmed yet
    await userEvent.click(screen.getByRole('checkbox', {name: /publish this version anyway/i}));
    expect(publish).toBeEnabled();
  });

  it('Write with AI fills the title, description and hashtags', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    api.on('POST /projects/:id/caption/generate', () => ({status: 202, body: {job: job({id: 'j-cap', type: 'caption'})}}));
    api.on('GET /jobs/:id', () => ({
      body: {job: job({id: 'j-cap', state: 'succeeded', output: {title: 'AI title', caption: 'AI text', hashtags: ['ai', 'shorts']}})},
    }));
    open('/app/p/p1/publish');
    await userEvent.click(await screen.findByRole('button', {name: /write with ai/i}));
    await waitFor(() => expect(screen.getByLabelText(/title/i)).toHaveValue('AI title'));
    expect(screen.getByLabelText(/description/i)).toHaveValue('AI text');
    expect(screen.getByText('#ai')).toBeInTheDocument();
  });

  it('shows the API refusal at the button', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    api.on('POST /renders/:id/publish', () =>
      apiError(409, 'reconnect_required', 'Your YouTube connection has expired. Connect YouTube again, then try again.'),
    );
    open('/app/p/p1/publish');
    await userEvent.click(await screen.findByRole('button', {name: /publish now/i}));
    expect(await screen.findByText(/connection has expired/i)).toBeInTheDocument();
  });
});

describe('Connect results (screens 21–22)', () => {
  it('shows the connected dialog once and removes the parameters', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    open('/app/p/p1/publish?connected=youtube');
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(within(dialog).getByText(/connected as asha shorts/i)).toBeInTheDocument();
  });

  it('an unknown reason is the generic failure', async () => {
    const done = aRender();
    setup({latestRender: done}, [done]);
    open('/app/p/p1/publish?connection_error=youtube&reason=<script>');
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(within(dialog).getByText(/didn't work\. please try again/i)).toBeInTheDocument();
  });
});
