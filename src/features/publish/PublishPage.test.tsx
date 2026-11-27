import {act, fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {POLL_MS} from '@/api/projects';
import {RENDER_POLL_MS} from '@/api/publishing';
import type {Connection, Post, Project, Render} from '@/api/types';
import {apiError, installFakeApi, job, project, scene, user, withBasics, type FakeApi} from '@/test/fakeApi';
import {aPost, aRender, aVideo, CHANNEL, EXPIRED, openAt, polyfillDialog, stubAssign, visited} from '@/test/f7';
import {CAPTION_MAX, HASHTAGS_MAX, PublishPage, TITLE_MAX} from './PublishPage';
import {RenderPage} from './RenderPage';

// Screens 13 and 20 (docs/SCREENS_F7.md sections 3-5; PUBLISHING_YOUTUBE.md F1, F4-F6; API A9, B5,
// G1). The backend is the fake `fetch` from src/test/fakeApi.ts.

let api: FakeApi;
let current: Project;
let me: Connection | null;
let post: Post;

function setup(over: Partial<Project> = {}, renders: Render[] | null = null, youtube: Connection | null = CHANNEL) {
  api = installFakeApi();
  const done = aRender();
  current = project({status: 'rendered', scenes: [scene(1)], latestRender: done, postTitle: 'Ocean computers', ...over});
  me = youtube;
  withBasics(api);
  api.on('GET /me', () => ({body: {user: user({connections: {youtube: me, instagram: null}})}}));
  api.on('GET /projects/:id', () => ({body: {project: current}}));
  const history = renders ?? (current.latestRender ? [current.latestRender] : []);
  api.on('GET /projects/:id/renders', () => ({body: {items: history}}));
  api.on('PATCH /projects/:id', (req) => {
    current = {...current, ...req.body};
    return {body: {project: current, estimate: {credits: 0, balance: 99, items: []}}};
  });
  post = aPost({title: 'Ocean computers'});
  api.on('POST /renders/:id/publish', (req, {id}) => {
    post = {...post, renderId: id, title: req.body.title, state: 'queued', progress: 0, error: null};
    return {status: 202, body: {post, job: job({type: 'publish'})}};
  });
  api.on('GET /posts/:id', () => ({body: {post}}));
}

const routes = [
  {path: '/app/p/:id/publish', element: <PublishPage />},
  {path: '/app/p/:id/render', element: <RenderPage />},
];
const open = (path = '/app/p/p1/publish') => openAt(path, routes);

const titleBox = () => screen.getByRole('textbox', {name: /^title/i});
const captionBox = () => screen.getByRole('textbox', {name: /^description/i});
const tagBox = () => screen.getByRole('textbox', {name: /^hashtags/i});
const publishNow = () => screen.getByRole('button', {name: /^(publish now|try again)$/i});
const published = () => api.calls('POST /renders/:id/publish');
const patches = () => api.calls('PATCH /projects/:id');
const chips = () => screen.queryAllByRole('button', {name: /^Remove #/}).map((b) => b.getAttribute('aria-label')!.slice(8));
const ready = () => screen.findByRole('heading', {name: 'Publish'});
const SAVE_WAIT = {timeout: 3000};

/** Fake timers that still let real time pass, so Testing Library's waits keep working. */
function fakeClock() {
  vi.useFakeTimers({shouldAdvanceTime: true});
  return userEvent.setup({advanceTimers: vi.advanceTimersByTime});
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  polyfillDialog();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- layout and channel

describe('Publish: layout and the channel row', () => {
  it('shows the latest finished video, the platform tiles as a radio group and the steps with Publish', async () => {
    setup();
    open();
    await ready();
    expect(screen.getByLabelText('Video of Three morning habits')).toHaveAttribute('src', '/media/r1.mp4');
    expect(screen.getByLabelText('Video of Three morning habits')).toHaveAttribute('poster', '/media/r1.jpeg');
    const tiles = screen.getByRole('radiogroup', {name: 'Platform'});
    const [yt, ig] = within(tiles).getAllByRole('radio');
    expect(yt).toHaveTextContent('YouTube Shorts');
    expect(yt).toHaveAttribute('aria-checked', 'true');
    expect(ig).toHaveTextContent(/Instagram Reels.*Coming soon/);
    expect(ig).toHaveAttribute('aria-checked', 'false');
    expect(ig).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('link', {name: 'Back to the video'})).toHaveAttribute('href', '/app/p/p1/render');
    expect(screen.getByText('Credits for the music and voice are added at the end of the description.')).toBeInTheDocument();
  });

  it('without any finished render, asks to render first', async () => {
    setup({latestRender: null, status: 'ready'}, []);
    open();
    expect(await screen.findByText('Render the Reel first')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Go to the render'})).toHaveAttribute('href', '/app/p/p1/render');
    expect(screen.queryByRole('button', {name: /publish now/i})).not.toBeInTheDocument();
  });

  it('connected: the channel picture and name, Change, and the top bar pill links to settings', async () => {
    setup();
    open();
    await ready();
    expect(document.querySelector('img[src="https://yt3.example/asha.jpg"]')).not.toBeNull();
    const pill = screen.getByRole('link', {name: /asha shorts/i});
    expect(pill).toHaveAttribute('href', '/app/settings?tab=youtube');
    expect(within(pill).getByLabelText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Change'})).toBeEnabled();
    expect(publishNow()).toBeEnabled();
  });

  it('not connected: explains the testing limit, Connect YouTube, Publish disabled, no pill', async () => {
    setup({}, null, null);
    open();
    await ready();
    expect(screen.getByText(/only accounts added as testers can connect/i)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeEnabled();
    expect(publishNow()).toBeDisabled();
    expect(screen.queryByRole('link', {name: /youtube/i})).not.toBeInTheDocument();
  });

  it('reconnect_required: a warning, Reconnect YouTube, Publish disabled, and the pill says Reconnect', async () => {
    setup({}, null, EXPIRED);
    open();
    await ready();
    expect(screen.getByText('Your YouTube connection has expired.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Reconnect YouTube'})).toBeEnabled();
    expect(screen.getByRole('link', {name: 'Reconnect YouTube'})).toHaveAttribute('href', '/app/settings?tab=youtube');
    expect(publishNow()).toBeDisabled();
  });

  it.each([
    ['Connect YouTube', null],
    ['Reconnect YouTube', EXPIRED],
    ['Change', CHANNEL],
  ] as const)('%s calls F1 with this page as returnTo, goes to Google and stays busy', async (name, youtube) => {
    setup({}, null, youtube);
    api.on('GET /connections/:platform/connect', () => ({body: {authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=s'}}));
    const assign = stubAssign();
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=s'));
    expect(api.calls('GET /connections/:platform/connect')[0].path).toBe(
      `/connections/youtube/connect?returnTo=${encodeURIComponent('/app/p/p1/publish')}`,
    );
    // Busy until the page has gone, so it can't be pressed twice.
    expect(screen.getByRole('button', {name})).toBeDisabled();
  });

  it('a failed Connect shows why under the row', async () => {
    setup({}, null, null);
    api.on('GET /connections/:platform/connect', () => apiError(503, 'provider_unavailable', 'YouTube publishing is not set up yet.'));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: 'Connect YouTube'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube publishing is not set up yet.');
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeEnabled();
  });

  it('a failed Change shows why under the row', async () => {
    setup();
    api.on('GET /connections/:platform/connect', () => apiError(503, 'provider_unavailable', 'YouTube publishing is not set up yet.'));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: 'Change'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube publishing is not set up yet.');
  });

  it('a page shown again from the back/forward cache is no longer busy', async () => {
    setup({}, null, null);
    api.on('GET /connections/:platform/connect', () => ({body: {authorizeUrl: 'https://accounts.google.com/x'}}));
    const assign = stubAssign();
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: 'Connect YouTube'}));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeDisabled();
    const shown = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(shown, 'persisted', {value: true});
    act(() => {
      window.dispatchEvent(shown);
    });
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeEnabled();
  });
});

// ---------------------------------------------------------------- the text fields

describe('Publish: title, description and hashtags', () => {
  it('the title starts from postTitle, else from the Reel title; the counters describe the fields (QF7-013)', async () => {
    setup({postTitle: ''});
    open();
    await ready();
    expect(titleBox()).toHaveValue('Three morning habits');
    // Round 2: the counters sit outside the labels, so the names stay "Title" and "Description".
    expect(titleBox()).toHaveAccessibleName('Title');
    expect(titleBox()).toHaveAccessibleDescription('20/100');
    expect(screen.getByRole('textbox', {name: 'Description'})).toHaveAccessibleDescription(/0\/2200/);
  });

  it('a Reel title over 100 characters is cut to 100 for the post title', async () => {
    setup({postTitle: '', title: 'T'.repeat(130)});
    open();
    await ready();
    expect(titleBox()).toHaveValue('T'.repeat(TITLE_MAX));
  });

  it('starts from the saved postTitle, postCaption and hashtags', async () => {
    setup({postTitle: 'Saved title', postCaption: 'Saved text', hashtags: ['one', 'two']});
    open();
    await ready();
    expect(titleBox()).toHaveValue('Saved title');
    expect(captionBox()).toHaveValue('Saved text');
    expect(chips()).toEqual(['one', 'two']);
    expect(screen.getByText('2/30')).toBeInTheDocument();
  });

  it('title: empty, over 100 and < > are refused with a reason, and Publish is disabled', async () => {
    setup();
    open();
    await ready();
    await userEvent.clear(titleBox());
    expect(screen.getByText('Add a title')).toBeInTheDocument();
    expect(titleBox()).toHaveAttribute('aria-invalid', 'true');
    expect(titleBox()).toHaveAccessibleDescription(/^Add a title/); // the counter follows the reason
    expect(publishNow()).toBeDisabled();

    await userEvent.paste('x'.repeat(TITLE_MAX));
    expect(screen.queryByText(/characters or fewer/)).not.toBeInTheDocument();
    expect(publishNow()).toBeEnabled();
    await userEvent.type(titleBox(), 'y');
    expect(screen.getByText('Use 100 characters or fewer')).toBeInTheDocument();
    expect(titleBox()).toHaveAccessibleDescription(/101\/100/);
    expect(publishNow()).toBeDisabled();

    await userEvent.clear(titleBox());
    await userEvent.type(titleBox(), 'a > b');
    expect(screen.getByText('Remove the < and > characters')).toBeInTheDocument();
    expect(publishNow()).toBeDisabled();
    expect(published()).toHaveLength(0);
  });

  it('description: over 2,200 and < > are refused, and Publish is disabled', async () => {
    setup();
    open();
    await ready();
    captionBox().focus();
    await userEvent.paste('d'.repeat(CAPTION_MAX));
    expect(publishNow()).toBeEnabled();
    await userEvent.type(captionBox(), 'e');
    expect(screen.getByText('Use 2200 characters or fewer')).toBeInTheDocument();
    expect(captionBox()).toHaveAttribute('aria-invalid', 'true');
    expect(publishNow()).toBeDisabled();
    await userEvent.clear(captionBox());
    await userEvent.type(captionBox(), 'see <here>');
    expect(screen.getByText('Remove the < and > characters')).toBeInTheDocument();
    expect(publishNow()).toBeDisabled();
  });

  it('hashtags: Enter and comma add a chip, # is dropped, duplicates are ignored, × removes', async () => {
    setup();
    open();
    await ready();
    await userEvent.type(tagBox(), '#Shorts{Enter}facts,##ocean{Enter}');
    expect(chips()).toEqual(['Shorts', 'facts', 'ocean']);
    expect(screen.getByText('#Shorts')).toBeInTheDocument();
    expect(tagBox()).toHaveValue('');
    await userEvent.type(tagBox(), 'shorts{Enter}#{Enter}');
    expect(chips()).toEqual(['Shorts', 'facts', 'ocean']);
    await userEvent.click(screen.getByRole('button', {name: 'Remove #facts'}));
    expect(chips()).toEqual(['Shorts', 'ocean']);
  });

  it('hashtags: pasting "a, b c" adds three; Backspace in the empty box removes the last; leaving the box adds what was typed', async () => {
    setup();
    open();
    await ready();
    tagBox().focus();
    await userEvent.paste('a, b c');
    expect(chips()).toEqual(['a', 'b', 'c']);
    await userEvent.type(tagBox(), '{Backspace}');
    expect(chips()).toEqual(['a', 'b']);
    await userEvent.type(tagBox(), 'typed');
    await userEvent.click(titleBox());
    expect(chips()).toEqual(['a', 'b', 'typed']);
  });

  it('hashtags: at most 30; the box is disabled at 30 and a paste stops at the limit', async () => {
    setup({hashtags: Array.from({length: 27}, (_, i) => `t${i}`)});
    open();
    await ready();
    tagBox().focus();
    await userEvent.paste('x1 x2 x3 x4 x5');
    expect(chips()).toHaveLength(HASHTAGS_MAX);
    expect(chips().slice(-3)).toEqual(['x1', 'x2', 'x3']);
    expect(screen.getByText('30/30')).toBeInTheDocument();
    expect(tagBox()).toBeDisabled();
  });

  it('a hashtag still in the box is sent with Publish, once', async () => {
    setup({hashtags: ['shorts']});
    open();
    await ready();
    await userEvent.type(tagBox(), 'Shorts');
    fireEvent.click(publishNow());
    await waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0].body.hashtags).toEqual(['shorts']);
  });

  it('visibility: Public by default, one choice at a time, sent with Publish; the verification note shows', async () => {
    setup();
    open();
    await ready();
    expect(screen.getByRole('button', {name: 'Public'})).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', {name: 'Private'}));
    expect(screen.getByRole('button', {name: 'Private'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: 'Public'})).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/YouTube may keep it private until ReelForge is verified/)).toBeInTheDocument();
    await userEvent.click(publishNow());
    await waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0].body.visibility).toBe('private');
    expect(published()[0].body).not.toHaveProperty('confirmOutdated');
  });
});

// ---------------------------------------------------------------- autosave

describe('Publish: autosave (B5 postTitle, postCaption, hashtags)', () => {
  it('opening the page with nothing typed saves nothing', async () => {
    setup({postTitle: 'Ocean computers'});
    open();
    await ready();
    await act(() => new Promise((r) => setTimeout(r, 1200)));
    expect(patches()).toHaveLength(0);
  });

  it('each field is saved on its own once typing pauses', async () => {
    setup();
    open();
    await ready();
    await userEvent.type(captionBox(), 'Hello');
    await waitFor(() => expect(patches()).toHaveLength(1), SAVE_WAIT);
    expect(patches()[0].body).toEqual({postCaption: 'Hello'});
    await userEvent.type(tagBox(), 'one{Enter}');
    await waitFor(() => expect(patches()).toHaveLength(2), SAVE_WAIT);
    expect(patches()[1].body).toEqual({hashtags: ['one']});
    await userEvent.type(titleBox(), '!');
    await waitFor(() => expect(patches()).toHaveLength(3), SAVE_WAIT);
    expect(patches()[2].body).toEqual({postTitle: 'Ocean computers!'});
  });

  it('a title that is empty, too long or has < > is not sent, while the description still is', async () => {
    setup();
    open();
    await ready();
    await userEvent.clear(titleBox());
    titleBox().focus();
    await userEvent.paste('z'.repeat(TITLE_MAX + 1));
    await userEvent.type(captionBox(), 'Body');
    await waitFor(() => expect(patches()).toHaveLength(1), SAVE_WAIT);
    expect(patches()[0].body).toEqual({postCaption: 'Body'});

    await userEvent.clear(titleBox());
    await userEvent.type(titleBox(), '<b>');
    await act(() => new Promise((r) => setTimeout(r, 1200)));
    expect(patches()).toHaveLength(1);
  });

  it('a description with < > or over 2,200 characters is not sent', async () => {
    setup();
    open();
    await ready();
    await userEvent.type(captionBox(), 'a <b>');
    await act(() => new Promise((r) => setTimeout(r, 1200)));
    expect(patches()).toHaveLength(0);
  });

  it('a failed save is shown and sent again with the next change', async () => {
    setup();
    let fail = true;
    api.on('PATCH /projects/:id', (req) => {
      if (fail) return apiError(500, 'internal_error', 'Something failed on our side.');
      current = {...current, ...req.body};
      return {body: {project: current, estimate: {credits: 0, balance: 99, items: []}}};
    });
    open();
    await ready();
    await userEvent.type(captionBox(), 'Lost?');
    expect(await screen.findByText('Something failed on our side.', {}, SAVE_WAIT)).toBeInTheDocument();
    fail = false;
    await userEvent.type(tagBox(), 'next{Enter}');
    await waitFor(() => expect(patches()).toHaveLength(2), SAVE_WAIT);
    expect(patches()[1].body).toEqual({postCaption: 'Lost?', hashtags: ['next']});
    await waitFor(() => expect(screen.queryByText('Something failed on our side.')).not.toBeInTheDocument());
  });

  it('text not yet sent is sent when the page closes', async () => {
    setup();
    const view = open();
    await ready();
    await userEvent.type(captionBox(), 'Last words');
    expect(patches()).toHaveLength(0);
    view.unmount();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({postCaption: 'Last words'});
  });

  it('a field that failed to save is sent again when the page closes', async () => {
    setup();
    let fail = true;
    api.on('PATCH /projects/:id', (req) => {
      if (fail) return apiError(500, 'internal_error', 'Something failed on our side.');
      current = {...current, ...req.body};
      return {body: {project: current, estimate: {credits: 0, balance: 99, items: []}}};
    });
    const view = open();
    await ready();
    await userEvent.type(captionBox(), 'Keep me');
    await screen.findByText('Something failed on our side.', {}, SAVE_WAIT);
    fail = false;
    view.unmount();
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1].body).toEqual({postCaption: 'Keep me'});
  });

  it('going to Google sends the unsent text first', async () => {
    setup({}, null, null);
    api.on('GET /connections/:platform/connect', () => ({body: {authorizeUrl: 'https://accounts.google.com/x'}}));
    const assign = stubAssign();
    const view = open();
    await ready();
    await userEvent.type(captionBox(), 'Before Google');
    await userEvent.click(screen.getByRole('button', {name: 'Connect YouTube'}));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    view.unmount(); // the browser leaves the page
    await waitFor(() => expect(patches().some((p) => p.body.postCaption === 'Before Google')).toBe(true));
  });
});

// ---------------------------------------------------------------- Write with AI

describe('Publish: Write with AI (F4, G1)', () => {
  const AI = {title: 'AI title', caption: 'AI text', hashtags: ['ai', 'shorts']};
  function aiAnswers(state: 'succeeded' | 'failed' | 'running' = 'succeeded') {
    api.on('POST /projects/:id/caption/generate', () => ({status: 202, body: {job: job({id: 'j-cap', type: 'caption'})}}));
    api.on('GET /jobs/:id', () => ({
      body: {
        job: job({
          id: 'j-cap',
          state,
          output: state === 'succeeded' ? AI : null,
          error: state === 'failed' ? {code: 'provider_error', message: 'The writer is busy. Try again in a minute.'} : null,
        }),
      },
    }));
  }

  it('with nothing typed, writes without asking, fills the fields, and does not save them again', async () => {
    setup({postTitle: ''});
    aiAnswers();
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /write with ai/i}));
    await waitFor(() => expect(titleBox()).toHaveValue('AI title'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(captionBox()).toHaveValue('AI text');
    expect(chips()).toEqual(['ai', 'shorts']);
    expect(screen.getByText('Free')).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 1200)));
    expect(patches()).toHaveLength(0); // F4 saved the text on the project itself
  });

  it('with text typed, asks before replacing; No keeps everything and sends nothing', async () => {
    setup();
    aiAnswers();
    vi.mocked(window.confirm).mockReturnValue(false);
    open();
    await ready();
    await userEvent.type(captionBox(), 'Mine');
    await userEvent.click(screen.getByRole('button', {name: /write with ai/i}));
    expect(window.confirm).toHaveBeenCalledWith('Replace the title, description and hashtags with new ones?');
    expect(api.calls('POST /projects/:id/caption/generate')).toHaveLength(0);
    expect(captionBox()).toHaveValue('Mine');
  });

  it('with text typed, OK replaces it', async () => {
    setup();
    aiAnswers();
    open();
    await ready();
    await userEvent.type(tagBox(), 'mine{Enter}');
    await userEvent.click(screen.getByRole('button', {name: /write with ai/i}));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(chips()).toEqual(['ai', 'shorts']));
  });

  it('a failed job shows its reason', async () => {
    setup({postTitle: ''});
    aiAnswers('failed');
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /write with ai/i}));
    expect(await screen.findByRole('alert')).toHaveTextContent('The writer is busy. Try again in a minute.');
    expect(titleBox()).toHaveValue('Three morning habits');
  });

  it('a refused start shows its reason', async () => {
    setup({postTitle: ''});
    api.on('POST /projects/:id/caption/generate', () => apiError(503, 'provider_unavailable', 'Writing is unavailable right now.'));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /write with ai/i}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Writing is unavailable right now.');
  });

  it('stops polling the job when the page closes', async () => {
    const user = fakeClock();
    setup({postTitle: ''});
    aiAnswers('running');
    const view = open();
    await ready();
    await user.click(screen.getByRole('button', {name: /write with ai/i}));
    await waitFor(() => expect(api.calls('GET /jobs/:id').length).toBeGreaterThan(0));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(api.calls('GET /jobs/:id').length).toBeGreaterThan(1));
    view.unmount();
    const polls = api.calls('GET /jobs/:id').length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(api.calls('GET /jobs/:id').length).toBe(polls);
  });
});

// ---------------------------------------------------------------- outdated and refusals

describe('Publish: an outdated render (YT-13)', () => {
  it('needs "Publish this version anyway" ticked, offers Render again, and sends confirmOutdated', async () => {
    setup({latestRender: aRender({outdated: true})});
    open();
    await ready();
    expect(screen.getByText(/you edited the reel after this render/i)).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Or render it again'})).toHaveAttribute('href', '/app/p/p1/render');
    expect(publishNow()).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', {name: 'Publish this version anyway'}));
    await userEvent.click(publishNow());
    await waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0].body.confirmOutdated).toBe(true);
  });

  it('a render_outdated refusal shows the same confirm, and the next try sends confirmOutdated', async () => {
    setup();
    let n = 0;
    api.on('POST /renders/:id/publish', (req, {id}) => {
      n += 1;
      if (n === 1) return apiError(409, 'render_outdated', 'The Reel was edited after this render.');
      post = {...post, renderId: id, title: req.body.title};
      return {status: 202, body: {post, job: job({type: 'publish'})}};
    });
    open();
    await ready();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(publishNow());
    expect(await screen.findByText(/Tick "Publish this version anyway", or render again/)).toBeInTheDocument();
    expect(publishNow()).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', {name: 'Publish this version anyway'}));
    await userEvent.click(publishNow());
    await waitFor(() => expect(published()).toHaveLength(2));
    expect(published()[0].body).not.toHaveProperty('confirmOutdated');
    expect(published()[1].body.confirmOutdated).toBe(true);
  });
});

describe('Publish: F5 refusals and their guidance', () => {
  it('sends an Idempotency-Key, a new one per try', async () => {
    setup();
    api.on('POST /renders/:id/publish', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    open();
    await ready();
    await userEvent.click(publishNow());
    await screen.findByText('Something failed on our side.');
    await userEvent.click(publishNow());
    await waitFor(() => expect(published()).toHaveLength(2));
    expect(published()[0].headers['Idempotency-Key']).toBeTruthy();
    expect(published()[0].headers['Idempotency-Key']).not.toBe(published()[1].headers['Idempotency-Key']);
  });

  it('not_connected points to the channel row and refreshes it', async () => {
    setup();
    api.on('POST /renders/:id/publish', () => {
      me = null;
      return apiError(409, 'not_connected', 'Connect YouTube first.');
    });
    open();
    await ready();
    await userEvent.click(publishNow());
    expect(await screen.findByText('Connect your YouTube channel above first.')).toBeInTheDocument();
    expect(await screen.findByRole('button', {name: 'Connect YouTube'})).toBeInTheDocument();
  });

  it('reconnect_required points to the channel row and refreshes it', async () => {
    setup();
    api.on('POST /renders/:id/publish', () => {
      me = EXPIRED;
      return apiError(409, 'reconnect_required', 'Reconnect.');
    });
    open();
    await ready();
    await userEvent.click(publishNow());
    expect(await screen.findByText('Your YouTube connection has expired. Reconnect YouTube above, then publish.')).toBeInTheDocument();
    expect(await screen.findByRole('button', {name: 'Reconnect YouTube'})).toBeInTheDocument();
  });

  it('already_posted links to the Short that is already on YouTube', async () => {
    // The page didn't know about the post (published from another tab, or a stale page).
    setup({latestPost: null});
    const live = aPost({id: 'post0', state: 'published', progress: 100, url: 'https://youtube.com/shorts/already'});
    api.on('POST /renders/:id/publish', () => {
      current = {...current, status: 'posted', latestPost: live};
      return apiError(409, 'already_posted', 'This video is already on YouTube.');
    });
    open();
    await ready();
    await userEvent.click(publishNow());
    await screen.findByText(/already on YouTube/i);
    expect(await screen.findByRole('link', {name: /open it on youtube|open on youtube/i})).toHaveAttribute(
      'href',
      'https://youtube.com/shorts/already',
    );
  });

  it.each([
    ['already_running', 'This video is being published already.'],
    ['not_ready', 'This render has not finished.'],
  ])('%s shows its message at the button', async (code, message) => {
    setup();
    api.on('POST /renders/:id/publish', () => apiError(409, code, message));
    open();
    await ready();
    await userEvent.click(publishNow());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(publishNow()).toBeEnabled();
  });

  it('a 400 shows the field reason', async () => {
    setup();
    api.on('POST /renders/:id/publish', () =>
      apiError(400, 'validation_error', 'Check the fields.', {fields: {title: 'YouTube refuses this title.'}}),
    );
    open();
    await ready();
    await userEvent.click(publishNow());
    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube refuses this title.');
  });

  it('while a new render is running, publishing waits for it (F5 refuses it then; QF7-017)', async () => {
    setup({status: 'rendering'});
    api.on('GET /renders/:id', () => ({body: {render: current.latestRender}}));
    open();
    await ready();
    expect(screen.getByText("A new render is running. Publishing opens again when it's done.")).toBeInTheDocument();
    expect(publishNow()).toBeDisabled();
  });
});

// ---------------------------------------------------------------- tracker and live

describe('Publish: the tracker (F6) and "Your Short is live"', () => {
  it('replaces the form, takes focus, polls F6 every 3 s through each step to live, which takes focus', async () => {
    const user = fakeClock();
    setup();
    open();
    await ready();
    await user.click(publishNow());
    const heading = await screen.findByRole('heading', {name: 'Publishing to YouTube'});
    expect(heading).toHaveFocus();
    expect(screen.queryByRole('textbox', {name: /^title/i})).not.toBeInTheDocument();
    const steps = screen.getByRole('list', {name: 'Publishing steps'});
    const current = () => within(steps).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    expect(current()).toHaveTextContent('Queued');
    expect(screen.getByText('Queued', {selector: '[role="status"]'})).toBeInTheDocument();
    expect(screen.getByText('You can leave this page; publishing carries on.')).toBeInTheDocument();

    post = {...post, state: 'uploading', progress: 35};
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    await waitFor(() => expect(current()).toHaveTextContent('Uploading'));
    expect(screen.getByRole('progressbar', {name: 'Publishing progress'})).toHaveAttribute('aria-valuenow', '35');
    expect(screen.getByText('Uploading', {selector: '[role="status"]'})).toBeInTheDocument();
    expect(within(steps).getAllByRole('listitem')[0]).toHaveTextContent('✓');

    post = {...post, state: 'processing', progress: 80};
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    await waitFor(() => expect(current()).toHaveTextContent('Processing'));

    post = {...post, state: 'published', progress: 100, url: 'https://youtube.com/shorts/abc', publishedAt: '2026-11-26T10:30:00Z'};
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    const live = await screen.findByRole('heading', {name: 'Your Short is live'});
    expect(live).toHaveFocus();
    expect(api.calls('GET /posts/:id').every((r) => r.path === '/posts/post1')).toBe(true);
    const polls = api.calls('GET /posts/:id').length;
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS * 3));
    expect(api.calls('GET /posts/:id').length).toBe(polls);
  });

  it('opening a Reel that is being published shows the tracker at once', async () => {
    setup({status: 'posting', latestPost: aPost({state: 'uploading', progress: 40})});
    post = aPost({state: 'uploading', progress: 40});
    open();
    expect(await screen.findByRole('heading', {name: 'Publishing to YouTube'})).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name: 'Publishing progress'})).toHaveAttribute('aria-valuenow', '40');
  });

  it('a failed post on the same render: the reason, "continues where it stopped", and Try again sends F5 again', async () => {
    const user = fakeClock();
    setup();
    open();
    await ready();
    await user.click(publishNow());
    await screen.findByRole('heading', {name: 'Publishing to YouTube'});
    post = {...post, state: 'failed', error: {code: 'quota_exceeded', message: "YouTube's daily upload limit is reached. Try again tomorrow."}};
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    expect(await screen.findByText(/daily upload limit is reached.*Press Try again; it continues where it stopped\./)).toBeInTheDocument();
    const again = screen.getByRole('button', {name: 'Try again'});
    await user.click(again);
    await waitFor(() => expect(published()).toHaveLength(2));
    expect(published()[1].path).toBe('/renders/r1/publish');
  });

  it('Try again after a failed post keeps the visibility that was chosen (Private stays Private)', async () => {
    const user = fakeClock();
    setup();
    open();
    await ready();
    await user.click(screen.getByRole('button', {name: 'Private'}));
    await user.click(publishNow());
    await screen.findByRole('heading', {name: 'Publishing to YouTube'});
    expect(published()[0].body.visibility).toBe('private');
    post = {...post, visibility: 'private', state: 'failed', error: {code: 'upload_failed', message: 'The upload stopped.'}};
    await act(() => vi.advanceTimersByTimeAsync(RENDER_POLL_MS));
    const again = await screen.findByRole('button', {name: 'Try again'});
    expect(screen.getByRole('button', {name: 'Private'})).toHaveAttribute('aria-pressed', 'true');
    await user.click(again);
    await waitFor(() => expect(published()).toHaveLength(2));
    expect(published()[1].body.visibility).toBe('private');
  });

  it('a failed post on an older render: "This video is a newer render" and Publish now', async () => {
    const newer = aVideo('r2');
    setup({latestRender: newer, latestPost: aPost({renderId: 'r1', state: 'failed', error: {code: 'upload_failed', message: 'The upload stopped.'}})});
    post = current.latestPost!;
    open();
    await ready();
    expect(screen.getByText(/The upload stopped\. This video is a newer render\./)).toBeInTheDocument();
    expect(screen.queryByText(/continues where it stopped/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Publish now'}));
    await waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0].path).toBe('/renders/r2/publish');
  });

  it('a posted Reel opens the live view: private note, Open on YouTube in a new tab, next steps', async () => {
    const live = aPost({state: 'published', progress: 100, url: 'https://youtube.com/shorts/xyz', privateUntilVerified: true, title: 'Ocean computers'});
    setup({status: 'posted', latestPost: live});
    post = live;
    open();
    const heading = await screen.findByRole('heading', {name: 'Your Short is live'});
    const region = heading.closest('section')!;
    // Round 2 (QF7-023): it takes focus instead of being a status region, so it is read once.
    expect(region).not.toHaveAttribute('role', 'status');
    expect(within(region).getByText('Ocean computers')).toBeInTheDocument();
    expect(within(region).getByText(/YouTube kept it private until ReelForge is verified by Google/)).toBeInTheDocument();
    const link = within(region).getByRole('link', {name: /open on youtube/i});
    expect(link).toHaveAttribute('href', 'https://youtube.com/shorts/xyz');
    expect(link).toHaveAttribute('target', '_blank');
    expect(within(region).getByRole('link', {name: 'Create another Reel'})).toHaveAttribute('href', '/app/new');
    expect(within(region).getByRole('link', {name: 'Back to the dashboard'})).toHaveAttribute('href', '/app');
    // Same render as the post: nothing new to publish.
    expect(within(region).queryByRole('button', {name: 'Publish again'})).not.toBeInTheDocument();
  });

  it('the private note shows only when YouTube kept it private', async () => {
    const live = aPost({state: 'published', progress: 100, url: 'https://youtube.com/shorts/xyz', privateUntilVerified: false});
    setup({status: 'posted', latestPost: live});
    post = live;
    open();
    await screen.findByRole('heading', {name: 'Your Short is live'});
    expect(screen.queryByText(/kept it private/)).not.toBeInTheDocument();
  });

  it('Copy link copies the address and says so', async () => {
    const live = aPost({state: 'published', progress: 100, url: 'https://youtube.com/shorts/xyz'});
    setup({status: 'posted', latestPost: live});
    post = live;
    open();
    await screen.findByRole('heading', {name: 'Your Short is live'});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
    fireEvent.click(screen.getByRole('button', {name: 'Copy link'}));
    expect(await screen.findByRole('button', {name: 'Link copied'})).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('https://youtube.com/shorts/xyz');
  });

  it('Copy link says when copying failed (refused, or no clipboard)', async () => {
    const live = aPost({state: 'published', progress: 100, url: 'https://youtube.com/shorts/xyz'});
    setup({status: 'posted', latestPost: live});
    post = live;
    open();
    await screen.findByRole('heading', {name: 'Your Short is live'});
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: vi.fn().mockRejectedValue(new Error('denied'))}, configurable: true});
    fireEvent.click(screen.getByRole('button', {name: 'Copy link'}));
    expect(await screen.findByRole('button', {name: 'Copy failed; select the link'})).toBeInTheDocument();
    Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
    fireEvent.click(screen.getByRole('button', {name: /copy/i}));
    expect(screen.getByRole('button', {name: 'Copy failed; select the link'})).toBeInTheDocument();
  });

  it('Publish again appears for a newer render and publishes that render', async () => {
    const newer = aVideo('r2');
    const live = aPost({renderId: 'r1', state: 'published', progress: 100, url: 'https://youtube.com/shorts/old'});
    setup({status: 'rendered', latestRender: newer, latestPost: live});
    post = live;
    open();
    await screen.findByRole('heading', {name: 'Your Short is live'});
    await userEvent.click(screen.getByRole('button', {name: 'Publish again'}));
    expect(await screen.findByRole('heading', {name: 'Publish'})).toBeInTheDocument();
    expect(screen.getByLabelText('Video of Three morning habits')).toHaveAttribute('src', '/media/r2.mp4');
    await userEvent.click(publishNow());
    await waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0].path).toBe('/renders/r2/publish');
    expect(await screen.findByRole('heading', {name: 'Publishing to YouTube'})).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- connect results

describe('Connect results (screens 21-22)', () => {
  it('connected: the dialog names the channel, shows once, and the parameters leave the address (others stay)', async () => {
    setup();
    open('/app/p/p1/publish?tab=x&connected=youtube&platform=youtube');
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(within(dialog).getByRole('heading', {name: 'YouTube connected', hidden: true})).toBeInTheDocument();
    expect(within(dialog).getByText('Connected as Asha Shorts. You can publish Shorts from ReelForge now.')).toBeInTheDocument();
    await waitFor(() => expect(visited[visited.length - 1]).toBe('/app/p/p1/publish?tab=x'));
    // The new connection is fetched again (A9).
    await waitFor(() => expect(api.calls('GET /me').length).toBeGreaterThan(1));
    await userEvent.click(within(dialog).getByRole('button', {name: 'OK', hidden: true}));
    await waitFor(() => expect(screen.queryByRole('dialog', {hidden: true})).not.toBeInTheDocument());
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(screen.queryByRole('dialog', {hidden: true})).not.toBeInTheDocument();
  });

  it.each([
    ['denied', "You didn't allow ReelForge to upload. Try again and allow both permissions."],
    ['missing_permission', 'ReelForge needs permission to upload videos. Try again and keep both boxes ticked.'],
    ['failed', "Connecting YouTube didn't work. Please try again."],
    ['toString', "Connecting YouTube didn't work. Please try again."],
    ['', "Connecting YouTube didn't work. Please try again."],
  ])('reason %j shows its text and the parameters leave the address', async (reason, text) => {
    setup({}, null, null);
    open(`/app/p/p1/publish?connection_error=youtube&reason=${reason}`);
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(within(dialog).getByRole('heading', {name: "YouTube isn't connected", hidden: true})).toBeInTheDocument();
    expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', {hidden: true})).not.toBeInTheDocument();
    await waitFor(() => expect(visited[visited.length - 1]).toBe('/app/p/p1/publish'));
  });

  it('no reason at all is the generic failure', async () => {
    setup({}, null, null);
    open('/app/p/p1/publish?connection_error=youtube');
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(within(dialog).getByText("Connecting YouTube didn't work. Please try again.")).toBeInTheDocument();
  });

  it('no_channel links to creating a channel on YouTube, in a new tab', async () => {
    setup({}, null, null);
    open('/app/p/p1/publish?connection_error=youtube&reason=no_channel');
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(within(dialog).getByText(/This Google account has no YouTube channel yet/)).toBeInTheDocument();
    const link = within(dialog).getByRole('link', {name: 'Create a channel', hidden: true});
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/create_channel');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('the dialog is labelled by its title and described by its text', async () => {
    setup({}, null, null);
    open('/app/p/p1/publish?connection_error=youtube&reason=denied');
    const dialog = await screen.findByRole('dialog', {hidden: true});
    expect(dialog).toHaveAccessibleName("YouTube isn't connected");
    expect(dialog).toHaveAccessibleDescription(/didn't allow ReelForge to upload/);
  });
});
