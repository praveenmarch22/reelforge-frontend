import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {forwardRef, useEffect, useImperativeHandle} from 'react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {TimelineAnswer} from '@/api/projects';
import type {CreditsInfo, Mood, Project, Scene} from '@/api/types';
import type {Timeline} from '@/remotion/types';
import {MOODS} from '@/features/create/SceneCard';
import {apiError, credits, estimate, installFakeApi, job, project, scene, withBasics, type FakeApi} from '@/test/fakeApi';
import {ReelEditorPage} from './ReelEditorPage';

// Screen 11, Reel editor (docs/SCREENS_F5_F6.md sections 3 and 4; API B4, B5, B10-B12, C2, C7-C10,
// D3, D4, G1, H1). The backend is a fake `fetch` that keeps one project. The Remotion Player is
// replaced by a stand-in that shows what it was given and records seeks: drawing is Remotion's job,
// and the renderer's own code is checked by src/remotion/sync.test.ts.

const player = vi.hoisted(() => ({
  seeks: [] as number[],
  props: null as null | Record<string, any>,
  /** A file can't be played: the video, audio or image element reports it (round 3: `onMediaError`). */
  fail: false,
  /** The drawing itself throws: Remotion shows the page's errorFallback. */
  drawFail: false,
}));

vi.mock('@remotion/player', () => ({
  Player: forwardRef(function FakePlayer(props: Record<string, any>, ref) {
    useImperativeHandle(ref, () => ({seekTo: (frame: number) => player.seeks.push(frame)}));
    player.props = props;
    const t = props.inputProps as Timeline & {onMediaError?: (e: Error) => void};
    useEffect(() => {
      if (player.fail) t.onMediaError?.(new Error('MediaError: Code 4'));
    });
    if (player.drawFail && props.errorFallback) return <div role="figure" aria-label="Player">{props.errorFallback({error: new Error('draw')})}</div>;
    return (
      <div role="figure" aria-label="Player">
        <p>
          {props.durationInFrames} frames at {props.fps} fps
        </p>
        <p>captions: {t.showCaptions ? t.captionStyle : 'off'}</p>
        <ul>
          {t.scenes.map((s) => (
            <li key={s.id}>{s.onScreenText}</li>
          ))}
        </ul>
      </div>
    );
  }),
}));

let api: FakeApi;
let current: Project;
let costs: CreditsInfo;
const FPS = 30;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function open() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/p/${current.id}/edit`]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <Routes>
          <Route path="/app/p/:id/edit" element={<ReelEditorPage />} />
          <Route path="/app/p/:id/script" element={<Where />} />
          <Route path="/app/projects" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Presigned links differ on every response (API: "different on every response"). */
let signature = 0;
const signed = (url: string | undefined) => (url ? `${url}?sig=${signature}` : '');

/** B12 as the API builds it: a scene lasts its voice plus 0.3 s (at least 1.5 s), else its estimate. */
function timelineOf(p: Project): TimelineAnswer {
  signature += 1;
  let start = 0;
  const scenes = [...p.scenes]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const seconds = s.voice?.durationSeconds ? s.voice.durationSeconds + 0.3 : s.estimatedSeconds;
      const frames = Math.round(Math.max(1.5, seconds) * FPS);
      const ready = s.voiceStatus === 'ready' && s.visualStatus === 'ready';
      const out = {
        id: s.id,
        startFrame: start,
        durationInFrames: frames,
        mood: s.mood,
        onScreenText: s.onScreenText,
        visual: {kind: 'image' as const, src: signed(s.visual?.url), durationSeconds: null, motion: 'zoom-in' as const},
        voice: {src: signed(s.voice?.url), durationSeconds: s.voice?.durationSeconds ?? null},
        words: s.words,
        ready,
      };
      start += frames;
      return out;
    });
  const seconds = start / FPS;
  return {
    timelineVersion: p.timelineVersion,
    timeline: {
      version: p.timelineVersion,
      projectId: p.id,
      fps: FPS,
      width: 1080,
      height: 1920,
      durationInFrames: start,
      captionStyle: p.settings.captionStyle,
      showCaptions: p.settings.showCaptions,
      voiceVolume: p.settings.voiceVolume,
      music: null,
      scenes,
    },
    durationSeconds: Math.round(seconds * 10) / 10,
    tooLong: seconds > 90,
    ready: scenes.every((s) => s.ready),
  };
}

function readyScene(n: number, over: Partial<Scene> = {}): Scene {
  return scene(n, {
    voiceStatus: 'ready',
    visualStatus: 'ready',
    voice: {assetId: `va${n}`, url: `https://s3/v${n}.mp3`, durationSeconds: 2.2, provider: 'elevenlabs', voiceId: 'v-laura', estimatedTimings: false},
    visual: {
      assetId: `ia${n}`, url: `https://s3/i${n}.mp4`, durationSeconds: 7, kind: 'video', thumbnailUrl: `https://s3/t${n}.jpg`,
      provider: 'pixabay', author: `Author ${n}`, sourceUrl: `https://pixabay.com/videos/clip-${n}/`, width: 1080, height: 1920, stockFallback: false,
    },
    words: [
      {text: 'Scene', start: 0, end: 0.4},
      {text: String(n), start: 0.4, end: 0.8},
      {text: 'narration', start: 0.8, end: 1.4},
    ],
    ...over,
  });
}

const readyProject = (over: Partial<Project> = {}, scenes = [readyScene(1), readyScene(2), readyScene(3)]) =>
  project({status: 'ready', ...over}, scenes);

const track = (id: string, title: string, durationSeconds: number, moods: Mood[]) => ({
  id, title, durationSeconds, moods, license: `"${title}" Kevin MacLeod (incompetech.com), CC BY 4.0`,
  sourceUrl: 'https://incompetech.com', previewUrl: `https://s3/${id}.mp3`,
});
const TRACKS = [
  track('m1', 'Carefree', 204, ['inspiring', 'joyful']),
  track('m2', 'Wallpaper', 180, ['calm']),
  track('m3', 'Wholesome', 95, ['inspiring', 'calm']),
];

function serve() {
  api.on('GET /credits', () => ({body: costs}));
  api.on('GET /projects/:id', () => ({body: {project: current}}));
  api.on('GET /projects/:id/timeline', () => ({body: timelineOf(current)}));
  api.on('GET /projects/:id/estimate', () => ({body: estimate(4, 77)}));
  api.on('GET /music', (req) => {
    const mood = new URLSearchParams(req.path.split('?')[1] ?? '').get('mood');
    return {body: {items: TRACKS.filter((t) => !mood || t.moods.includes(mood as never))}};
  });
  api.on('PATCH /scenes/:id', (req, {id}) => saveScene(id, req.body));
  api.on('PATCH /projects/:id', (req) => {
    const {settings, ...rest} = req.body;
    current = {...current, ...rest, settings: {...current.settings, ...(settings ?? {})}, timelineVersion: current.timelineVersion + 1};
    return {body: {project: current, estimate: estimate()}};
  });
}

/** Saves a scene the way C2 does (every edit raises the timeline version). */
function saveScene(id: string, body: Record<string, unknown>) {
  current = {
    ...current,
    timelineVersion: current.timelineVersion + 1,
    scenes: current.scenes.map((s) => (s.id === id ? ({...s, ...body} as Scene) : s)),
  };
  if (body.words) {
    const fixed = body.words as {text: string}[];
    current.scenes = current.scenes.map((s) =>
      s.id === id ? {...s, wordsEdited: true, words: s.words.map((w, i) => ({...w, text: fixed[i].text}))} : s,
    );
  }
  return {body: {scene: current.scenes.find((s) => s.id === id), estimate: estimate()}};
}

/** PATCH /scenes/:id answers only when `release()` is called; later saves answer at once. */
function holdFirstSceneSave(fail = false) {
  const gate: {release: () => void} = {release: () => {}};
  let n = 0;
  api.on('PATCH /scenes/:id', async (req, {id}) => {
    n += 1;
    if (n === 1) await new Promise<void>((r) => (gate.release = r));
    if (fail) return apiError(500, 'internal_error', 'Something failed on our side.');
    return saveScene(id, req.body);
  });
  return gate;
}

function wouldWarnOnLeaving(): boolean {
  const event = new Event('beforeunload', {cancelable: true});
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Fake timers that still let real time pass, so Testing Library's waits keep working. */
function fakeClock() {
  vi.useFakeTimers({shouldAdvanceTime: true});
  return userEvent.setup({advanceTimers: vi.advanceTimersByTime});
}

const loaded = () => screen.findByRole('figure', {name: 'Player'});
const sceneButton = (n: number) => screen.getByRole('button', {name: new RegExp(`^Scene ${n}:`)});
const inspector = () => screen.getByRole('region', {name: /^Scene \d+ settings$/});
const tab = (name: 'Visual' | 'Voice' | 'Text') => screen.getByRole('tab', {name});
const patches = () => api.calls('PATCH /scenes/:id');
const indexOf = (method: string, path: RegExp) => api.requests.findIndex((r) => r.method === method && path.test(r.path.split('?')[0]));
const last = <T,>(list: T[]): T => list[list.length - 1];
/** The track list's groups: label and option texts. */
const groups = (select: HTMLElement) =>
  [...select.querySelectorAll('optgroup')].map((g) => ({label: g.label, titles: [...g.querySelectorAll('option')].map((o) => o.textContent)}));
const longText = (n: number) => Array.from({length: n}, (_, i) => `w${i}`).join(' ');

beforeEach(() => {
  player.seeks = [];
  player.props = null;
  player.fail = false;
  player.drawFail = false;
  api = installFakeApi();
  withBasics(api);
  costs = credits(77);
  current = readyProject();
  serve();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- the page

describe('Reel editor: header, player and states', () => {
  it('shows the title, status, credits, the length, the player with the timeline and a disabled Render', async () => {
    open();
    await loaded();
    expect(screen.getByRole('heading', {level: 1, name: 'Three morning habits'})).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(await screen.findByRole('link', {name: /credits left$/})).toBeInTheDocument();
    const t = timelineOf(current);
    // The player gets B12's timeline: its frames, fps and size.
    expect(player.props).toMatchObject({
      durationInFrames: t.timeline.durationInFrames,
      fps: FPS,
      compositionWidth: 1080,
      compositionHeight: 1920,
      controls: true,
    });
    expect(screen.getByText(`${t.durationSeconds.toFixed(1)}s`)).toBeInTheDocument();
    const renderButton = screen.getByRole('button', {name: /render/i});
    expect(renderButton).toBeDisabled();
    // Round 2 (QF6-016): the note is visible text, and describes the button.
    expect(screen.getByText('Rendering to a video comes next')).toBeVisible();
    expect(renderButton).toHaveAccessibleDescription('Rendering to a video comes next');
    // Nothing is missing: no Generate missing.
    expect(screen.queryByRole('button', {name: /generate missing/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument(); // the app shell owns <main>
    // Round 3 (QF6-018): Back is a button, because it saves first; with nothing unsaved it just goes.
    await userEvent.click(screen.getByRole('button', {name: 'Back to the script'}));
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/script');
  });

  it('a project whose script is still being written opens the Script editor', async () => {
    current = project({status: 'scripting', activeJobs: [job({type: 'script', state: 'running'})]}, []);
    open();
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/script');
  });

  it('an unknown project goes back to the projects list', async () => {
    api.on('GET /projects/:id', () => apiError(404, 'not_found', "We couldn't find that."));
    open();
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/projects');
  });

  it('a project that fails to load offers Try again', async () => {
    let fail = true;
    api.on('GET /projects/:id', () => (fail ? apiError(500, 'internal_error', 'boom') : {body: {project: current}}));
    open();
    const again = await screen.findByRole('button', {name: 'Try again'});
    expect(screen.getByText(/We couldn't load this Reel/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(again);
    expect(await loaded()).toBeInTheDocument();
  });

  it('while generating: the progress line counts ready parts, it polls every 2 s, then shows the length and refetches the timeline', async () => {
    current = project({status: 'generating', activeJobs: [job({type: 'voice', state: 'running'})]}, [
      readyScene(1),
      scene(2, {voiceStatus: 'running', visualStatus: 'ready'}),
      scene(3, {voiceStatus: 'queued', visualStatus: 'running'}),
    ]);
    open();
    const progress = await screen.findByText(/Making your Reel: 3 of 6 parts ready/);
    expect(progress.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('button', {name: /generate missing/i})).not.toBeInTheDocument();
    expect(await screen.findByText(/Scenes still being made show a coloured placeholder/)).toBeInTheDocument();
    const timelinesBefore = api.calls('GET /projects/:id/timeline').length;

    current = readyProject({timelineVersion: 2});
    await waitFor(() => expect(screen.queryByText(/Making your Reel/)).not.toBeInTheDocument(), {timeout: 5000});
    await waitFor(() => expect(api.calls('GET /projects/:id/timeline').length).toBeGreaterThan(timelinesBefore));
    expect(await screen.findByText(`${timelineOf(current).durationSeconds.toFixed(1)}s`)).toBeInTheDocument();
    expect(screen.queryByText(/coloured placeholder/)).not.toBeInTheDocument();
  });

  it('over 90 s says to shorten it before rendering (tooLong)', async () => {
    current = readyProject({}, [readyScene(1, {voice: {...readyScene(1).voice!, durationSeconds: 95}})]);
    open();
    expect(await screen.findByText(/over 90 s: shorten it before rendering/)).toBeInTheDocument();
  });

  it('needs_attention: says so; a failed scene is marked, shows its error, and Retry generates just that scene', async () => {
    current = project({status: 'needs_attention'}, [
      readyScene(1),
      readyScene(2, {voiceStatus: 'failed', lastError: 'The voice service didn’t answer. Try again.'}),
      readyScene(3),
    ]);
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [job({type: 'voice'})], creditsReserved: 1, balance: 76}}));
    open();
    await loaded();
    expect(screen.getByText(/Some parts couldn't be made/)).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Retry scene 1'})).not.toBeInTheDocument();
    expect(within(sceneButton(2)).getByText(/Voice failed, visual ready/)).toBeInTheDocument();
    await userEvent.click(sceneButton(2));
    expect(within(inspector()).getByText('The voice service didn’t answer. Try again.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', {name: 'Retry scene 2'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    const call = api.calls('POST /projects/:id/generate')[0];
    expect(call.body).toEqual({sceneIds: ['s2']});
    expect(call.headers['Idempotency-Key']).toMatch(/\S/);
  });

  it('a busy scene shows its spinner state and no Retry', async () => {
    current = project({status: 'generating', activeJobs: [job()]}, [readyScene(1), scene(2, {voiceStatus: 'running', visualStatus: 'failed'})]);
    open();
    await loaded();
    expect(within(sceneButton(2)).getByText(/Voice being made, visual failed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Retry scene 2'})).not.toBeInTheDocument();
  });
});

describe('Reel editor: Generate missing (B10, B11)', () => {
  beforeEach(() => {
    current = project({status: 'draft'}, [readyScene(1), scene(2, {voiceStatus: 'outdated', visualStatus: 'ready'}), scene(3)]);
  });

  it('shows the cost from B10 and sends an Idempotency-Key, a new one per click', async () => {
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    const button = await screen.findByRole('button', {name: /Generate missing · 4 credits/});
    await userEvent.click(button);
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', {name: /Generate missing/})).toBeEnabled());
    await userEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(2));
    const [a, b] = api.calls('POST /projects/:id/generate');
    expect(a.body).toEqual({});
    expect(a.headers['Idempotency-Key']).toBeTruthy();
    expect(a.headers['Idempotency-Key']).not.toBe(b.headers['Idempotency-Key']);
  });

  it('out of credits (402) shows the shared out-of-credits message', async () => {
    api.on('POST /projects/:id/generate', () =>
      apiError(402, 'insufficient_credits', 'Not enough credits.', {needed: 4, balance: 1, resetsAt: '2026-12-01T00:00:00Z'}),
    );
    open();
    await userEvent.click(await screen.findByRole('button', {name: /Generate missing/}));
    expect(await screen.findByText(/This needs 4 credits and you have 1\. Your credits renew on/)).toBeInTheDocument();
  });

  it('waits for unsaved inspector text to be saved first', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Narration'}), ' more');
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
    await act(async () => gate.release());
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    expect(indexOf('PATCH', /^\/scenes\/s1$/)).toBeLessThan(indexOf('POST', /\/generate$/));
  });

  // QF5-020 (fixed in the Script editor): the button must be busy from the first moment of the click,
  // including while unsaved text is sent; otherwise a double click starts two runs with two keys.
  it('is busy from the first click: a double click while text is being saved starts one run', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Narration'}), ' more');
    const button = screen.getByRole('button', {name: /Generate missing/});
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(patches()).toHaveLength(1));
    await act(async () => gate.release());
    await waitFor(() => expect(api.calls('POST /projects/:id/generate').length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(1);
  });

  it('a save that keeps failing stops Generate with the reason', async () => {
    holdFirstSceneSave(true).release();
    api.on('PATCH /scenes/:id', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Narration'}), ' more');
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    expect(await screen.findByText('Some changes aren’t saved yet: Something failed on our side.', {}, {timeout: 3000})).toBeInTheDocument();
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- scene list and player

describe('Reel editor: scene list and player', () => {
  it('lists scenes with number, mood, first words and voice and visual status; the first is selected', async () => {
    current = readyProject({}, [readyScene(1, {mood: 'excited'}), scene(2, {voiceStatus: 'outdated', visualStatus: 'missing'})]);
    open();
    await loaded();
    const list = screen.getByRole('list', {name: 'Scenes'});
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(sceneButton(1)).toHaveAttribute('aria-current', 'true');
    expect(within(sceneButton(1)).getByText('excited')).toBeInTheDocument();
    expect(within(sceneButton(1)).getByText('Scene 1 narration goes here.')).toBeInTheDocument();
    expect(within(sceneButton(2)).getByText(/Voice out of date, visual not made yet/)).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Scene 01'})).toBeInTheDocument();
  });

  it('selecting a scene opens it in the inspector and moves the player to its first frame', async () => {
    open();
    await loaded();
    const t = timelineOf(current).timeline;
    await userEvent.click(sceneButton(3));
    expect(sceneButton(3)).toHaveAttribute('aria-current', 'true');
    expect(sceneButton(1)).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', {name: 'Scene 03'})).toBeInTheDocument();
    expect(last(player.seeks)).toBe(t.scenes[2].startFrame);
    await userEvent.click(sceneButton(2));
    expect(last(player.seeks)).toBe(t.scenes[1].startFrame);
  });

  it('scenes can be selected with the keyboard alone', async () => {
    open();
    await loaded();
    sceneButton(2).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('heading', {name: 'Scene 02'})).toBeInTheDocument();
  });

  // docs/SCREENS_F5_F6.md section 3, Scene list: "Click selects the scene; drag reorders (C5)".
  it('scenes can be reordered by dragging (C5)', async () => {
    api.on('POST /projects/:id/scenes/reorder', () => ({body: {scenes: current.scenes, estimate: estimate()}}));
    open();
    await loaded();
    const dragged = sceneButton(3).closest('[draggable="true"]');
    expect(dragged, 'scene 3 can be dragged').not.toBeNull();
    const target = sceneButton(1).closest('li')!;
    fireEvent.dragStart(dragged!, {dataTransfer: {effectAllowed: '', setData: () => {}}});
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(() => expect(api.calls('POST /projects/:id/scenes/reorder')).toHaveLength(1));
  });

  it('after an on-screen text edit the timeline is fetched again and the player shows it', async () => {
    open();
    await loaded();
    const before = api.calls('GET /projects/:id/timeline').length;
    await userEvent.click(tab('Text'));
    const box = screen.getByRole('textbox', {name: 'On-screen text'});
    await userEvent.clear(box);
    await userEvent.type(box, 'WAKE UP');
    await userEvent.tab();
    await waitFor(() => expect(api.calls('GET /projects/:id/timeline').length).toBeGreaterThan(before));
    expect(await within(screen.getByRole('figure', {name: 'Player'})).findByText('WAKE UP')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- inspector

describe('Reel editor: inspector tabs and accessibility', () => {
  it('has three labelled tabs; the selected one controls a panel labelled by it', async () => {
    open();
    await loaded();
    const list = screen.getByRole('tablist', {name: 'Scene settings'});
    expect(within(list).getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Visual', 'Voice', 'Text']);
    expect(tab('Visual')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tab('Voice'));
    expect(tab('Voice')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Visual')).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAccessibleName('Voice');
    expect(tab('Voice')).toHaveAttribute('aria-controls', panel.id);
    // Every field in the panels has a name.
    for (const name of ['Visual', 'Voice', 'Text'] as const) {
      await userEvent.click(tab(name));
      for (const el of within(screen.getByRole('tabpanel')).queryAllByRole('textbox')) expect(el).toHaveAccessibleName();
      for (const el of within(screen.getByRole('tabpanel')).queryAllByRole('combobox')) expect(el).toHaveAccessibleName();
    }
  });

  // WAI-ARIA tabs pattern: arrow keys move between tabs, and only the selected tab is in the Tab order.
  it('arrow keys move between the tabs (WAI-ARIA tabs pattern)', async () => {
    open();
    await loaded();
    tab('Visual').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Voice')).toHaveFocus();
    expect(tab('Voice')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Visual')).toHaveAttribute('aria-selected', 'true');
  });

  // Round 2 (FIX_LOG_F6): the tabs are one Tab stop; arrows wrap, Home and End jump.
  it('the tabs are one Tab stop; arrows wrap, Home and End jump, and only the shown panel is referenced', async () => {
    open();
    await loaded();
    expect(tab('Visual')).toHaveAttribute('tabindex', '0');
    expect(tab('Voice')).toHaveAttribute('tabindex', '-1');
    expect(tab('Text')).toHaveAttribute('tabindex', '-1');
    tab('Visual').focus();
    await userEvent.tab();
    expect(screen.getAllByRole('tab').some((t) => t === document.activeElement)).toBe(false);
    tab('Visual').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Text')).toHaveFocus();
    expect(tab('Text')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Text')).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{Home}');
    expect(tab('Visual')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(tab('Text')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Visual')).toHaveFocus();
    for (const t of screen.getAllByRole('tab')) {
      const controls = t.getAttribute('aria-controls');
      if (controls) expect(document.getElementById(controls), `${t.textContent} controls a panel on the page`).not.toBeNull();
    }
  });

  // Inspector.tsx says "Another scene: start on the same tab with a clean slate"; going through the
  // voices of several scenes should not need a click on Voice for each one.
  it('the selected tab is kept when another scene is selected', async () => {
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    await userEvent.click(sceneButton(2));
    expect(screen.getByRole('heading', {name: 'Scene 02'})).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: 'On-screen text'})).toHaveValue('Text 2');
  });
});

describe('Reel editor: Visual tab (C2, C8)', () => {
  it('shows the clip credit; changes the source (C2); Upload is shown but disabled', async () => {
    open();
    await loaded();
    expect(screen.getByRole('link', {name: 'Author 1'})).toHaveAttribute('href', 'https://pixabay.com/videos/clip-1/');
    expect(screen.getByRole('button', {name: 'Stock'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: 'Upload'})).toBeDisabled();
    await userEvent.click(screen.getByRole('button', {name: 'AI image'}));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({path: '/scenes/s1', body: {visualSource: 'ai_image'}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'AI image'})).toHaveAttribute('aria-pressed', 'true'));
    // The stock query and stock search only apply to stock scenes.
    expect(screen.queryByRole('textbox', {name: 'Stock search words'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /search stock/i})).not.toBeInTheDocument();
  });

  it('the cost comes from H1: stock is free, AI image and AI video cost an AI image', async () => {
    costs = {...credits(77), costs: {...credits(77).costs, aiImage: 4}};
    current = readyProject({}, [readyScene(1), readyScene(2, {visualSource: 'ai_image'}), readyScene(3, {visualSource: 'ai_video'})]);
    open();
    await loaded();
    expect(await screen.findByRole('button', {name: /Regenerate visual · free/})).toBeInTheDocument();
    await userEvent.click(sceneButton(2));
    expect(screen.getByRole('button', {name: /Regenerate visual · 4 credits/})).toBeInTheDocument();
    await userEvent.click(sceneButton(3));
    expect(screen.getByRole('button', {name: /Regenerate visual · 4 credits/})).toBeInTheDocument();
    expect(screen.getByText(/An AI image with slow motion/)).toBeInTheDocument();
  });

  it('regenerates the visual (C8) with an Idempotency-Key after saving an unsaved prompt', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /scenes/:id/visual/regenerate', () => ({status: 202, body: {job: job({type: 'visual'})}}));
    open();
    await loaded();
    await userEvent.type(screen.getByRole('textbox', {name: 'Visual prompt'}), ' at dawn');
    fireEvent.click(screen.getByRole('button', {name: /Regenerate visual/}));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(api.calls('POST /scenes/:id/visual/regenerate')).toHaveLength(0);
    await act(async () => gate.release());
    await waitFor(() => expect(api.calls('POST /scenes/:id/visual/regenerate')).toHaveLength(1));
    const call = api.calls('POST /scenes/:id/visual/regenerate')[0];
    expect(call.path).toBe('/scenes/s1/visual/regenerate');
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    expect(patches()[0].body).toEqual({visualPrompt: 'prompt 1 at dawn'});
  });

  it('while the visual is being made: prompt, stock words and source are locked, the button is busy, the voice is not', async () => {
    current = readyProject({activeJobs: [job({type: 'visual', state: 'running'})]}, [readyScene(1, {visualStatus: 'running'})]);
    open();
    await loaded();
    expect(screen.getByRole('textbox', {name: 'Visual prompt'})).toBeDisabled();
    expect(screen.getByRole('textbox', {name: 'Stock search words'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'AI image'})).toBeDisabled();
    expect(screen.getByRole('button', {name: /Regenerate visual/})).toBeDisabled();
    expect(screen.getByRole('button', {name: /Regenerate visual/})).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(tab('Voice'));
    expect(screen.getByRole('textbox', {name: 'Narration'})).toBeEnabled();
    expect(screen.getByRole('button', {name: /Regenerate voice/})).toBeEnabled();
  });

  it('a refused regenerate (409) shows the API message', async () => {
    api.on('POST /scenes/:id/visual/regenerate', () => apiError(409, 'already_running', 'A new visual is already being made.'));
    open();
    await loaded();
    await userEvent.click(screen.getByRole('button', {name: /Regenerate visual/}));
    expect(await screen.findByText('A new visual is already being made.')).toBeInTheDocument();
  });
});

describe('Reel editor: Voice tab (C2, C7, D3)', () => {
  it('the voice cost comes from H1 and follows the narration length (short scene, then per started 30 s)', async () => {
    costs = {...credits(77), costs: {...credits(77).costs, voiceSceneShort: 3, voicePer30s: 5}};
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    expect(await screen.findByRole('button', {name: /Regenerate voice · 3 credits/})).toBeInTheDocument();
    const box = screen.getByRole('textbox', {name: 'Narration'});
    fireEvent.change(box, {target: {value: longText(37)}}); // 14.8 s: still short
    expect(screen.getByRole('button', {name: /Regenerate voice · 3 credits/})).toBeInTheDocument();
    fireEvent.change(box, {target: {value: longText(40)}}); // 16 s
    expect(screen.getByRole('button', {name: /Regenerate voice · 5 credits/})).toBeInTheDocument();
    fireEvent.change(box, {target: {value: longText(80)}}); // 32 s: two started 30 s
    expect(screen.getByRole('button', {name: /Regenerate voice · 10 credits/})).toBeInTheDocument();
  });

  it('saves narration (debounced) and the mood; the mood menu lists the 10 moods', async () => {
    const user = fakeClock();
    open();
    await loaded();
    await user.click(tab('Voice'));
    await user.type(screen.getByRole('textbox', {name: 'Narration'}), ' Today.');
    expect(patches()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({narration: 'Scene 1 narration goes here. Today.'});
    expect(await screen.findByText('Saved')).toHaveAttribute('role', 'status');

    const mood = screen.getByRole('combobox', {name: 'Delivery mood'});
    expect(within(mood).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(MOODS);
    await user.selectOptions(mood, 'tense');
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1].body).toEqual({mood: 'tense'});
  });

  it('regenerates the voice (C7) with the chosen voice and an Idempotency-Key', async () => {
    api.on('POST /scenes/:id/voice/regenerate', () => ({status: 202, body: {job: job({type: 'voice'})}}));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    const picker = await screen.findByRole('combobox', {name: 'Voice for this take'});
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.selectOptions(picker, 'v-george');
    await userEvent.click(screen.getByRole('button', {name: /Regenerate voice/}));
    await waitFor(() => expect(api.calls('POST /scenes/:id/voice/regenerate')).toHaveLength(1));
    const call = api.calls('POST /scenes/:id/voice/regenerate')[0];
    expect(call.path).toBe('/scenes/s1/voice/regenerate');
    expect(call.body).toEqual({voiceId: 'v-george'});
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    // The project's voice is not changed (C7: this take only).
    expect(api.calls('PATCH /projects/:id')).toHaveLength(0);
  });

  it('CA-4: with hand-fixed caption words it asks first; Cancel sends nothing, OK sends confirmReplaceWords', async () => {
    current = readyProject({}, [readyScene(1, {wordsEdited: true})]);
    api.on('POST /scenes/:id/voice/regenerate', () => ({status: 202, body: {job: job({type: 'voice'})}}));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.click(screen.getByRole('button', {name: /Regenerate voice/}));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/caption words/i);
    expect(api.calls('POST /scenes/:id/voice/regenerate')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', {name: /Regenerate voice/}));
    await waitFor(() => expect(api.calls('POST /scenes/:id/voice/regenerate')).toHaveLength(1));
    expect(api.calls('POST /scenes/:id/voice/regenerate')[0].body).toMatchObject({confirmReplaceWords: true});
  });

  it('without hand-fixed words it does not ask', async () => {
    api.on('POST /scenes/:id/voice/regenerate', () => ({status: 202, body: {job: job({type: 'voice'})}}));
    const confirm = vi.spyOn(window, 'confirm');
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.click(screen.getByRole('button', {name: /Regenerate voice/}));
    await waitFor(() => expect(api.calls('POST /scenes/:id/voice/regenerate')).toHaveLength(1));
    expect(confirm).not.toHaveBeenCalled();
    expect(api.calls('POST /scenes/:id/voice/regenerate')[0].body).toEqual({});
  });

  it('while the voice is being made: narration, mood, voice and caption words are locked; the visual is not', async () => {
    current = readyProject({activeJobs: [job({type: 'voice', state: 'running'})]}, [readyScene(1, {voiceStatus: 'queued'})]);
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    expect(screen.getByRole('textbox', {name: 'Narration'})).toBeDisabled();
    expect(screen.getByRole('combobox', {name: 'Delivery mood'})).toBeDisabled();
    expect(screen.getByRole('combobox', {name: 'Voice for this take'})).toBeDisabled();
    expect(screen.getByRole('button', {name: /Regenerate voice/})).toBeDisabled();
    await userEvent.click(tab('Text'));
    expect(screen.getByRole('textbox', {name: 'Caption word 1'})).toBeDisabled();
    expect(screen.getByRole('textbox', {name: 'On-screen text'})).toBeEnabled();
    await userEvent.click(tab('Visual'));
    expect(screen.getByRole('textbox', {name: 'Visual prompt'})).toBeEnabled();
    expect(screen.getByRole('button', {name: /Regenerate visual/})).toBeEnabled();
  });

  it('when the voice job ends, the scene unlocks and the timeline is fetched again', async () => {
    current = readyProject({activeJobs: [job({type: 'voice', state: 'running'})]}, [readyScene(1, {voiceStatus: 'running'}), readyScene(2)]);
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    expect(screen.getByRole('textbox', {name: 'Narration'})).toBeDisabled();
    const before = api.calls('GET /projects/:id/timeline').length;
    current = readyProject({}, [readyScene(1, {voice: {...readyScene(1).voice!, assetId: 'va1-new', durationSeconds: 3}}), readyScene(2)]);
    await waitFor(() => expect(screen.getByRole('textbox', {name: 'Narration'})).toBeEnabled(), {timeout: 5000});
    await waitFor(() => expect(api.calls('GET /projects/:id/timeline').length).toBeGreaterThan(before));
    await waitFor(() => expect(player.props?.durationInFrames).toBe(timelineOf(current).timeline.durationInFrames));
  });

  // Same rule as Generate (QF5-020): no second take from a double click while text is being saved.
  it('Regenerate voice is busy from the first click: a double click while text is saved starts one take', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /scenes/:id/voice/regenerate', () => ({status: 202, body: {job: job({type: 'voice'})}}));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Narration'}), ' more');
    const button = screen.getByRole('button', {name: /Regenerate voice/});
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(patches()).toHaveLength(1));
    await act(async () => gate.release());
    await waitFor(() => expect(api.calls('POST /scenes/:id/voice/regenerate').length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(api.calls('POST /scenes/:id/voice/regenerate')).toHaveLength(1);
  });
});

describe('Reel editor: Text tab (C2 onScreenText, words)', () => {
  // Round 2 (QF6-002): caption words save as typed (0.8 s) and when a word is left; no Save button.
  it('fixes a caption word’s spelling: saved as typed, only the texts are sent, spaces are left out', async () => {
    const user = fakeClock();
    open();
    await loaded();
    await user.click(tab('Text'));
    expect(screen.queryByRole('button', {name: /save caption/i})).not.toBeInTheDocument();
    const word = screen.getByRole('textbox', {name: 'Caption word 3'});
    await user.clear(word);
    await user.type(word, 'narra shun');
    expect(word).toHaveValue('narrashun');
    expect(patches()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect(last(patches()).body).toEqual({words: [{text: 'Scene'}, {text: '1'}, {text: 'narrashun'}]});
    expect(await screen.findByText(/Fixed by hand/)).toBeInTheDocument();
    expect(await screen.findByText('Saved')).toHaveAttribute('role', 'status');
    // Leaving a word saves at once.
    const before = patches().length;
    await user.type(screen.getByRole('textbox', {name: 'Caption word 1'}), 's');
    await user.tab();
    await waitFor(() => expect(patches()).toHaveLength(before + 1));
    expect(last(patches()).body.words[0]).toEqual({text: 'Scenes'});
  }, 15_000); // two saves and many keystrokes: slow when the whole suite runs in parallel

  it('an emptied caption word is refused by the API and its message shown under the words', async () => {
    api.on('PATCH /scenes/:id', (req, {id}) =>
      req.body.words?.some((w: {text: string}) => !w.text)
        ? apiError(400, 'validation_error', 'Some details need another look.', {fields: {words: 'A caption word can’t be empty'}})
        : saveScene(id, req.body),
    );
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    await userEvent.clear(screen.getByRole('textbox', {name: 'Caption word 2'}));
    await userEvent.tab();
    const words = screen.getByRole('group', {name: 'Caption words'});
    expect(await within(words).findByRole('alert')).toHaveTextContent('A caption word can’t be empty');
    expect(wouldWarnOnLeaving()).toBe(true);
    // Typing the word back saves it, and the warning goes.
    await userEvent.type(screen.getByRole('textbox', {name: 'Caption word 2'}), 'one');
    await userEvent.tab();
    await waitFor(() => expect(within(words).queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
    expect(current.scenes[0].words.map((w) => w.text)).toEqual(['Scene', 'one', 'narration']);
  });

  it('with no voice yet, says caption words come later', async () => {
    current = project({status: 'draft'});
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    expect(screen.getByText(/Caption words appear here once the voice is made/)).toBeInTheDocument();
  });

  it('a caption fix being typed is kept while the project is polled for another scene’s job', async () => {
    current = readyProject({activeJobs: [job({type: 'visual', state: 'running'})]}, [readyScene(1), readyScene(2, {visualStatus: 'running'})]);
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    const word = screen.getByRole('textbox', {name: 'Caption word 1'});
    await userEvent.clear(word);
    await userEvent.type(word, 'Scena');
    const polls = api.calls('GET /projects/:id').length;
    await waitFor(() => expect(api.calls('GET /projects/:id').length).toBeGreaterThan(polls + 1), {timeout: 8000});
    expect(screen.getByRole('textbox', {name: 'Caption word 1'})).toHaveValue('Scena');
  }, 15_000); // waits for two real 2-second polls
});

// ---------------------------------------------------------------- autosave (as in F5)

describe('Reel editor: autosave of the inspector fields', () => {
  it('sends edits one at a time and in order; what is typed while a save is out is kept', async () => {
    const user = fakeClock();
    const gate = holdFirstSceneSave();
    open();
    await loaded();
    await user.click(tab('Voice'));
    const box = screen.getByRole('textbox', {name: 'Narration'});
    await user.type(box, ' a');
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(patches()).toHaveLength(1);
    await user.type(box, 'b');
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(patches()).toHaveLength(1); // waits for the first answer
    await act(async () => gate.release());
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches().map((c) => c.body.narration)).toEqual(['Scene 1 narration goes here. a', 'Scene 1 narration goes here. ab']);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('textbox', {name: 'Narration'})).toHaveValue('Scene 1 narration goes here. ab');
    expect(current.scenes[0].narration).toBe('Scene 1 narration goes here. ab');
  });

  it('the server’s older answer does not replace newer text in the visual prompt', async () => {
    const user = fakeClock();
    const gate = holdFirstSceneSave();
    open();
    await loaded();
    const box = screen.getByRole('textbox', {name: 'Visual prompt'});
    await user.type(box, ' x');
    await user.tab();
    await waitFor(() => expect(patches()).toHaveLength(1));
    await user.type(box, 'y');
    const fetches = api.calls('GET /projects/:id').length;
    await act(async () => gate.release());
    await waitFor(() => expect(api.calls('GET /projects/:id').length).toBeGreaterThan(fetches));
    expect(screen.getByRole('textbox', {name: 'Visual prompt'})).toHaveValue('prompt 1 xy');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await waitFor(() => expect(current.scenes[0].visualPrompt).toBe('prompt 1 xy'));
  });

  it('warns before closing the tab while an edit is unsaved, and not after it has landed', async () => {
    const gate = holdFirstSceneSave();
    open();
    await loaded();
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
    await userEvent.click(tab('Text'));
    await userEvent.type(screen.getByRole('textbox', {name: 'On-screen text'}), '!');
    expect(wouldWarnOnLeaving()).toBe(true);
    await userEvent.tab();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(wouldWarnOnLeaving()).toBe(true);
    await act(async () => gate.release());
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });

  it('selecting another scene sends the first scene’s unsaved text', async () => {
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Narration'}), ' kept');
    expect(patches()).toHaveLength(0);
    fireEvent.click(sceneButton(2));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({path: '/scenes/s1', body: {narration: 'Scene 1 narration goes here. kept'}});
    await userEvent.click(sceneButton(1));
    if (tab('Voice').getAttribute('aria-selected') !== 'true') await userEvent.click(tab('Voice'));
    await waitFor(() => expect(screen.getByRole('textbox', {name: 'Narration'})).toHaveValue('Scene 1 narration goes here. kept'));
  });

  it('leaving the editor sends unsaved text', async () => {
    const view = open();
    await loaded();
    await userEvent.type(screen.getByRole('textbox', {name: 'Stock search words'}), ' sunrise');
    view.unmount();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({path: '/scenes/s1', body: {stockQuery: 'query 1 sunrise'}});
  });

  it('a failed save shows the error, never "Saved", keeps warning, and stops Regenerate voice', async () => {
    api.on('PATCH /scenes/:id', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    api.on('POST /scenes/:id/voice/regenerate', () => ({status: 202, body: {job: job({type: 'voice'})}}));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    const box = screen.getByRole('textbox', {name: 'Narration'});
    await userEvent.type(box, ' lost?');
    await userEvent.tab();
    expect(await within(inspector()).findByRole('alert')).toHaveTextContent('Something failed on our side.');
    expect(within(inspector()).queryByText('Saved')).not.toBeInTheDocument();
    expect(box).toHaveValue('Scene 1 narration goes here. lost?');
    expect(wouldWarnOnLeaving()).toBe(true);
    await userEvent.click(screen.getByRole('button', {name: /Regenerate voice/}));
    expect(await screen.findByText('Some changes aren’t saved yet: Something failed on our side.')).toBeInTheDocument();
    expect(api.calls('POST /scenes/:id/voice/regenerate')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- stock search

describe('Reel editor: stock search (C9, C10)', () => {
  const items = (page: number) =>
    Array.from({length: 3}, (_, i) => ({
      providerId: `pixabay:${page}${i}`,
      thumbnailUrl: `https://cdn.pixabay.com/${page}${i}.jpg`,
      previewUrl: `https://cdn.pixabay.com/${page}${i}.mp4`,
      durationSeconds: 7.6 + i,
      width: 1080,
      height: 1920,
      author: `maker${page}${i}`,
      source: 'pixabay',
      pageUrl: `https://pixabay.com/videos/${page}${i}/`,
    }));

  beforeEach(() => {
    api.on('GET /scenes/:id/stock-search', (req) => {
      const q = new URLSearchParams(req.path.split('?')[1]);
      const page = Number(q.get('page'));
      return {body: {items: items(page), nextPage: page < 2 ? page + 1 : null, query: q.get('q') ?? 'query 1'}};
    });
  });

  it('searches with the scene’s words, pages with More and Previous, and says the videos are from Pixabay', async () => {
    open();
    await loaded();
    await userEvent.click(screen.getByRole('button', {name: /search stock/i}));
    const panel = screen.getByRole('region', {name: 'Stock search'});
    expect(await within(panel).findByRole('button', {name: 'Use a 8-second clip by maker10'})).toBeInTheDocument();
    // Round 2: "Pixabay" links to the site.
    expect(within(panel).getByText(/^Videos from/)).toHaveTextContent('Videos from Pixabay');
    expect(within(panel).getByRole('link', {name: 'Pixabay'})).toHaveAttribute('href', 'https://pixabay.com/');
    const first = api.calls('GET /scenes/:id/stock-search')[0];
    expect(first.path).toBe('/scenes/s1/stock-search?page=1');
    expect(within(panel).getByRole('button', {name: 'Previous'})).toBeDisabled();

    await userEvent.click(within(panel).getByRole('button', {name: 'More'}));
    expect(await within(panel).findByRole('button', {name: /by maker20$/})).toBeInTheDocument();
    expect(last(api.calls('GET /scenes/:id/stock-search')).path).toBe('/scenes/s1/stock-search?page=2');
    expect(within(panel).getByRole('button', {name: 'More'})).toBeDisabled(); // nextPage is null

    await userEvent.click(within(panel).getByRole('button', {name: 'Previous'}));
    expect(await within(panel).findByRole('button', {name: /by maker10$/})).toBeInTheDocument();

    await userEvent.type(within(panel).getByRole('textbox', {name: 'Search stock videos'}), 'ocean waves{Enter}');
    await waitFor(() => expect(last(api.calls('GET /scenes/:id/stock-search')).path).toBe('/scenes/s1/stock-search?page=1&q=ocean+waves'));
  });

  it('a result is used with C10 (free), and the project is fetched again', async () => {
    api.on('POST /scenes/:id/visual/select', () => ({status: 202, body: {job: job({type: 'visual'})}}));
    open();
    await loaded();
    await userEvent.click(screen.getByRole('button', {name: /search stock/i}));
    const fetches = api.calls('GET /projects/:id').length;
    await userEvent.click(await screen.findByRole('button', {name: /by maker11$/}));
    await waitFor(() => expect(api.calls('POST /scenes/:id/visual/select')).toHaveLength(1));
    const call = api.calls('POST /scenes/:id/visual/select')[0];
    expect(call).toMatchObject({path: '/scenes/s1/visual/select', body: {stock: 'pixabay:11'}});
    await waitFor(() => expect(api.calls('GET /projects/:id').length).toBeGreaterThan(fetches));
  });

  it('the clip already in use is marked and can’t be chosen again', async () => {
    current = readyProject({}, [readyScene(1, {visual: {...readyScene(1).visual!, sourceUrl: 'https://pixabay.com/videos/12/'}})]);
    open();
    await loaded();
    await userEvent.click(screen.getByRole('button', {name: /search stock/i}));
    expect(await screen.findByRole('button', {name: /by maker12$/})).toBeDisabled();
    expect(screen.getByRole('button', {name: /by maker11$/})).toBeEnabled();
  });

  it('no stock provider (503) says why', async () => {
    api.on('GET /scenes/:id/stock-search', () => apiError(503, 'provider_unavailable', 'Stock search isn’t available right now.'));
    open();
    await loaded();
    await userEvent.click(screen.getByRole('button', {name: /search stock/i}));
    expect(await screen.findByText('Stock search isn’t available right now.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- audio bar

describe('Reel editor: audio bar (B5, D4)', () => {
  it('changes the music mood and track (D4 list by mood), with a preview; Automatic clears the track', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const view = open();
    await loaded();
    const bar = screen.getByRole('region', {name: 'Audio and captions'});
    // Round 2 (QF6-006): the whole library, this mood's tracks first.
    const track = within(bar).getByRole('combobox', {name: 'Music track'});
    await within(track).findByRole('option', {name: /Wallpaper/});
    expect(api.calls('GET /music').map((c) => c.path)).toContain('/music');
    await userEvent.selectOptions(within(bar).getByRole('combobox', {name: 'Music mood'}), 'calm');
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    expect(api.calls('PATCH /projects/:id')[0].body).toEqual({musicMood: 'calm'});
    await waitFor(() => expect(groups(track)[0]).toEqual({label: expect.stringMatching(/calm/), titles: ['Wallpaper (3:00)', 'Wholesome (1:35)']}));
    await userEvent.selectOptions(track, 'm2');
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(2));
    expect(api.calls('PATCH /projects/:id')[1].body).toEqual({music: {trackId: 'm2'}});
    await userEvent.click(await within(bar).findByRole('button', {name: 'Play Wallpaper'}));
    expect(play).toHaveBeenCalled();
    expect(within(bar).getByRole('button', {name: 'Stop Wallpaper'})).toBeInTheDocument();

    await userEvent.selectOptions(track, '');
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(3));
    expect(api.calls('PATCH /projects/:id')[2].body).toEqual({music: null});
    view.unmount(); // while pause() is still stubbed
  });

  it('a volume slider saves once, 500 ms after it stops moving', async () => {
    fakeClock();
    open();
    await loaded();
    const voice = screen.getByRole('slider', {name: 'Voice volume'});
    fireEvent.change(voice, {target: {value: '0.8'}});
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.change(voice, {target: {value: '0.6'}});
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(api.calls('PATCH /projects/:id')).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(200));
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    expect(api.calls('PATCH /projects/:id')[0].body).toEqual({settings: {voiceVolume: 0.6}});
  });

  it('moving the voice and then the music slider within 500 ms saves both', async () => {
    fakeClock();
    open();
    await loaded();
    fireEvent.change(screen.getByRole('slider', {name: 'Voice volume'}), {target: {value: '0.5'}});
    await act(() => vi.advanceTimersByTimeAsync(200));
    fireEvent.change(screen.getByRole('slider', {name: 'Music volume'}), {target: {value: '0.4'}});
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await waitFor(() => expect(api.calls('PATCH /projects/:id').length).toBeGreaterThan(0));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(current.settings.musicVolume).toBe(0.4);
    expect(current.settings.voiceVolume, 'the voice volume reached the server').toBe(0.5);
    expect(screen.getByRole('slider', {name: 'Voice volume'})).toHaveValue('0.5');
  });

  it('a slider moved just before leaving the editor is still saved', async () => {
    fakeClock();
    const view = open();
    await loaded();
    fireEvent.change(screen.getByRole('slider', {name: 'Music volume'}), {target: {value: '0.1'}});
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.calls('PATCH /projects/:id').map((c) => c.body)).toContainEqual({settings: {musicVolume: 0.1}});
  });

  it('ducking, caption style and show captions save to settings, and the player follows', async () => {
    open();
    await loaded();
    const bar = screen.getByRole('region', {name: 'Audio and captions'});
    const ducking = within(bar).getByRole('checkbox', {name: 'Lower the music while the voice speaks'});
    expect(ducking).toBeChecked();
    await userEvent.click(ducking);
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    expect(api.calls('PATCH /projects/:id')[0].body).toEqual({settings: {ducking: false}});
    await waitFor(() => expect(ducking).not.toBeChecked());

    expect(within(bar).getByRole('button', {name: 'Bold pop'})).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(bar).getByRole('button', {name: 'Neon'}));
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(2));
    expect(api.calls('PATCH /projects/:id')[1].body).toEqual({settings: {captionStyle: 'neon'}});
    expect(await screen.findByText('captions: neon')).toBeInTheDocument();
    expect(within(bar).getByRole('button', {name: 'Neon'})).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(within(bar).getByRole('checkbox', {name: 'Show captions'}));
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(3));
    expect(api.calls('PATCH /projects/:id')[2].body).toEqual({settings: {showCaptions: false}});
    expect(await screen.findByText('captions: off')).toBeInTheDocument();
  });

  it('a refused audio change says so', async () => {
    api.on('PATCH /projects/:id', () => apiError(409, 'already_running', 'The Reel is rendering; try again when it’s done.'));
    open();
    await loaded();
    await userEvent.click(screen.getByRole('button', {name: 'Clean'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('The Reel is rendering; try again when it’s done.');
  });
});

// ---------------------------------------------------------------- round 2 (FIX_LOG_F6)

describe('Reel editor round 2: switching scenes with unsaved text (QF6-001, QF6-007)', () => {
  it('a save that fails keeps the editor on the scene, shows why, and moves on once it saves', async () => {
    const failing = {on: true};
    api.on('PATCH /scenes/:id', (req, {id}) => (failing.on ? apiError(500, 'internal_error', 'Something failed on our side.') : saveScene(id, req.body)));
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Narration'}), ' kept');
    await userEvent.click(sceneButton(2));
    expect(await screen.findByText('Some changes aren’t saved yet: Something failed on our side.')).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Scene 01'})).toBeInTheDocument();
    expect(sceneButton(1)).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('textbox', {name: 'Narration'})).toHaveValue('Scene 1 narration goes here. kept');
    failing.on = false;
    await userEvent.click(sceneButton(2));
    expect(await screen.findByRole('heading', {name: 'Scene 02'})).toBeInTheDocument();
    expect(screen.queryByText(/Some changes aren’t saved yet/)).not.toBeInTheDocument();
    expect(current.scenes[0].narration).toBe('Scene 1 narration goes here. kept');
  });

  it('switching waits for a save in flight, and coming back shows the saved text', async () => {
    const gate = holdFirstSceneSave();
    open();
    await loaded();
    await userEvent.type(screen.getByRole('textbox', {name: 'Visual prompt'}), ' at dusk');
    fireEvent.click(sceneButton(2));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(screen.getByRole('heading', {name: 'Scene 01'})).toBeInTheDocument(); // still waiting
    await act(async () => gate.release());
    expect(await screen.findByRole('heading', {name: 'Scene 02'})).toBeInTheDocument();
    await userEvent.click(sceneButton(1));
    expect(await screen.findByRole('heading', {name: 'Scene 01'})).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: 'Visual prompt'})).toHaveValue('prompt 1 at dusk');
  });
});

describe('Reel editor round 2: caption-word autosave (QF6-002)', () => {
  it('a failed save keeps the fix, shows the error, and the next blur sends the same text again', async () => {
    const failing = {on: true};
    api.on('PATCH /scenes/:id', (req, {id}) => (failing.on ? apiError(500, 'internal_error', 'Something failed on our side.') : saveScene(id, req.body)));
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    const word = screen.getByRole('textbox', {name: 'Caption word 1'});
    await userEvent.clear(word);
    await userEvent.type(word, 'Sceen');
    await userEvent.tab();
    const words = screen.getByRole('group', {name: 'Caption words'});
    expect(await within(words).findByRole('alert')).toHaveTextContent('Something failed on our side.');
    expect(word).toHaveValue('Sceen');
    expect(within(words).queryByText('Saved')).not.toBeInTheDocument();
    expect(wouldWarnOnLeaving()).toBe(true);
    failing.on = false;
    word.focus();
    await userEvent.tab();
    await waitFor(() => expect(current.scenes[0].words[0].text).toBe('Sceen'));
    const sent = patches().filter((p) => p.body.words).map((p) => p.body.words[0].text);
    expect(last(sent)).toBe('Sceen');
    expect(sent.filter((t: string) => t === 'Sceen').length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });

  it('Generate sends a caption fix being typed first', async () => {
    current = project({status: 'draft'}, [readyScene(1), scene(2)]);
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 1, balance: 76}}));
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    await userEvent.type(screen.getByRole('textbox', {name: 'Caption word 3'}), 's');
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    const saved = api.requests.findIndex((r) => r.method === 'PATCH' && r.path === '/scenes/s1' && r.body.words);
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(saved).toBeLessThan(indexOf('POST', /\/generate$/));
    expect(api.requests[saved].body.words[2]).toEqual({text: 'narrations'});
  });

  // The same guarantee as every field: an unsaved fix is never dropped without a word. Leaving the
  // Text tab unmounts the caption words, so the failed fix must still be there when coming back.
  it('a caption fix whose save failed is not lost by switching to another tab and back', async () => {
    api.on('PATCH /scenes/:id', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 1, balance: 76}}));
    current = project({status: 'draft'}, [readyScene(1), scene(2)]);
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    const word = screen.getByRole('textbox', {name: 'Caption word 1'});
    await userEvent.clear(word);
    await userEvent.type(word, 'Sceen');
    await userEvent.tab();
    expect(await within(screen.getByRole('group', {name: 'Caption words'})).findByRole('alert')).toBeInTheDocument();
    await userEvent.click(tab('Voice'));
    await userEvent.click(tab('Text'));
    expect.soft(wouldWarnOnLeaving(), 'leaving still warns').toBe(true);
    expect.soft(screen.getByRole('textbox', {name: 'Caption word 1'}), 'the fix is still in the box').toHaveValue('Sceen');
    // Generate must not go ahead as if the fix were saved.
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate').length + screen.queryAllByText(/aren’t saved yet/).length).toBeGreaterThan(0));
    expect.soft(api.calls('POST /projects/:id/generate'), 'Generate did not start with the fix unsaved').toHaveLength(0);
  });
});

describe('Reel editor round 2: volume sliders (BUG-059, BUG-060)', () => {
  it('a slider not yet sent counts for the leave warning, until it is saved', async () => {
    fakeClock();
    open();
    await loaded();
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
    fireEvent.change(screen.getByRole('slider', {name: 'Voice volume'}), {target: {value: '0.7'}});
    expect(wouldWarnOnLeaving()).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(600));
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
    expect(screen.getByRole('slider', {name: 'Voice volume'})).toHaveAttribute('aria-valuetext', '70 percent');
  });

  it('Generate sends a slider move not yet sent before it starts', async () => {
    current = project({status: 'draft'}, [readyScene(1), scene(2)]);
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 1, balance: 76}}));
    open();
    await loaded();
    fireEvent.change(screen.getByRole('slider', {name: 'Music volume'}), {target: {value: '0.15'}});
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    expect(indexOf('PATCH', /^\/projects\/p1$/)).toBeGreaterThanOrEqual(0);
    expect(indexOf('PATCH', /^\/projects\/p1$/)).toBeLessThan(indexOf('POST', /\/generate$/));
    expect(current.settings.musicVolume).toBe(0.15);
  });
});

describe('Reel editor round 2: drag reorder, narrator, music, pickers', () => {
  it('dragging scene 3 onto scene 1 sends the new order (C5); a refused order says so', async () => {
    let refuse = false;
    api.on('POST /projects/:id/scenes/reorder', (req) => {
      if (refuse) return apiError(400, 'validation_error', 'The scene list changed. Reload and try again.');
      current = {
        ...current,
        scenes: (req.body.sceneIds as string[]).map((sid, i) => ({...current.scenes.find((s) => s.id === sid)!, position: i + 1})),
      };
      return {body: {scenes: current.scenes, estimate: estimate()}};
    });
    open();
    await loaded();
    const drag = (from: number, to: number) => {
      fireEvent.dragStart(sceneButton(from).closest('[draggable="true"]')!, {dataTransfer: {effectAllowed: '', setData: () => {}}});
      const target = sceneButton(to).closest('li')!;
      fireEvent.dragOver(target);
      fireEvent.drop(target);
    };
    drag(3, 1);
    await waitFor(() => expect(api.calls('POST /projects/:id/scenes/reorder')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/scenes/reorder')[0].body).toEqual({sceneIds: ['s3', 's1', 's2']});
    await waitFor(() => expect(sceneButton(1)).toHaveAccessibleName(/^Scene 1: Scene 3 narration/));
    refuse = true;
    drag(1, 3);
    expect(await screen.findByText('The scene list changed. Reload and try again.')).toBeInTheDocument();
  });

  it('changing the narrator asks first; Cancel changes nothing, OK saves the project voice (B5)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    open();
    await loaded();
    const narrator = within(screen.getByRole('region', {name: 'Audio and captions'})).getByRole('combobox', {name: 'Narrator'});
    await waitFor(() => expect(narrator).toBeEnabled());
    expect(narrator).toHaveValue('v-laura');
    await userEvent.selectOptions(narrator, 'v-george');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/new voice/i);
    expect(api.calls('PATCH /projects/:id')).toHaveLength(0);
    expect(narrator).toHaveValue('v-laura');
    await userEvent.selectOptions(narrator, 'v-george');
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    expect(api.calls('PATCH /projects/:id')[0].body).toEqual({voiceId: 'v-george'});
    await waitFor(() => expect(narrator).toHaveValue('v-george'));
  });

  it('the narrator and "Voice for this take" are two pickers with their own ids', async () => {
    open();
    await loaded();
    await userEvent.click(tab('Voice'));
    const narrator = screen.getByRole('combobox', {name: 'Narrator'});
    const take = screen.getByRole('combobox', {name: 'Voice for this take'});
    expect(narrator).not.toBe(take);
    expect(narrator.id).not.toBe(take.id);
    expect(document.querySelectorAll(`[id="${narrator.id}"]`)).toHaveLength(1);
    await waitFor(() => expect(take).toBeEnabled());
    await userEvent.selectOptions(take, 'v-liam');
    expect(take).toHaveValue('v-liam');
    expect(narrator).toHaveValue('v-laura');
  });

  it('a chosen track stays named and selected after the mood changes; its license is shown', async () => {
    current = readyProject({music: {trackId: 'm2'}, musicMood: 'calm'});
    open();
    await loaded();
    const bar = screen.getByRole('region', {name: 'Audio and captions'});
    const track = within(bar).getByRole('combobox', {name: 'Music track'});
    await waitFor(() => expect(track).toHaveValue('m2'));
    expect(within(bar).getByText('"Wallpaper" Kevin MacLeod (incompetech.com), CC BY 4.0')).toBeInTheDocument();
    await userEvent.selectOptions(within(bar).getByRole('combobox', {name: 'Music mood'}), 'joyful');
    await waitFor(() => expect(groups(track)[0].titles).toEqual(['Carefree (3:24)']));
    expect(track).toHaveValue('m2');
    expect((track as HTMLSelectElement).selectedOptions[0].textContent).toBe('Wallpaper (3:00)');
    expect(groups(track)[1]).toEqual({label: 'Other moods', titles: ['Wallpaper (3:00)', 'Wholesome (1:35)']});
    expect(within(track).getByRole('option', {name: 'Automatic for this mood'})).toBeInTheDocument();
  });

  it('the mood group reads naturally before a vowel ("For an inspiring Reel")', async () => {
    open();
    await loaded();
    const track = within(screen.getByRole('region', {name: 'Audio and captions'})).getByRole('combobox', {name: 'Music track'});
    await waitFor(() => expect(groups(track).length).toBeGreaterThan(0));
    expect(groups(track)[0].label).toBe('For an inspiring Reel');
  });

  it('a Regenerate visual double click while text is saved starts one job (BUG-058)', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /scenes/:id/visual/regenerate', () => ({status: 202, body: {job: job({type: 'visual'})}}));
    open();
    await loaded();
    await userEvent.type(screen.getByRole('textbox', {name: 'Visual prompt'}), ' x');
    const button = screen.getByRole('button', {name: /Regenerate visual/});
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(patches()).toHaveLength(1));
    await act(async () => gate.release());
    await waitFor(() => expect(api.calls('POST /scenes/:id/visual/regenerate').length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(api.calls('POST /scenes/:id/visual/regenerate')).toHaveLength(1);
  });
});

describe('Reel editor round 2: player links and errors (QF6-008, QF6-009)', () => {
  const shownTimeline = () => player.props!.inputProps as Timeline;

  it('a timeline fetched again keeps the links the player already has (same files)', async () => {
    open();
    await loaded();
    const first = shownTimeline().scenes[0].voice.src;
    expect(first).toMatch(/\?sig=\d+$/);
    const fetches = api.calls('GET /projects/:id/timeline').length;
    await userEvent.click(tab('Text'));
    await userEvent.type(screen.getByRole('textbox', {name: 'On-screen text'}), '!');
    await userEvent.tab();
    await waitFor(() => expect(api.calls('GET /projects/:id/timeline').length).toBeGreaterThan(fetches));
    await waitFor(() => expect(shownTimeline().scenes[0].onScreenText).toBe('Text 1!'));
    expect(shownTimeline().scenes[0].voice.src).toBe(first);
  });

  it('a file that can’t play shows why and "Reload preview", which fetches fresh links', async () => {
    // Round 3: the stand-in reports the broken file through inputProps.onMediaError, as the
    // shared renderer's video, audio and image elements now do.
    player.fail = true;
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent("The preview couldn't load one of its files.");
    const reload = await screen.findByRole('button', {name: 'Reload preview'});
    const old = shownTimeline().scenes[0].voice.src;
    const fetches = api.calls('GET /projects/:id/timeline').length;
    player.fail = false;
    await userEvent.click(reload);
    await waitFor(() => expect(api.calls('GET /projects/:id/timeline').length).toBeGreaterThan(fetches));
    await waitFor(() => expect(shownTimeline().scenes[0].voice.src).not.toBe(old));
    expect(screen.queryByRole('button', {name: 'Reload preview'})).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load one of its files/)).not.toBeInTheDocument();
  });

  it('a drawing error shows "The preview couldn\'t be shown" in the player', async () => {
    player.drawFail = true;
    open();
    const fig = await screen.findByRole('figure', {name: 'Player'});
    expect(within(fig).getByText("The preview couldn't be shown.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- round 3 (FIX_LOG_F6, Round 3)

describe('Reel editor round 3: hidden tab panels keep saving (QF6-018, BUG-066)', () => {
  it('a failed caption fix stays through a tab switch and is retried; Generate sends it first', async () => {
    const failing = {on: true};
    api.on('PATCH /scenes/:id', (req, {id}) => (failing.on ? apiError(500, 'internal_error', 'Something failed on our side.') : saveScene(id, req.body)));
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 1, balance: 76}}));
    current = project({status: 'draft'}, [readyScene(1), scene(2)]);
    open();
    await loaded();
    await userEvent.click(tab('Text'));
    const word = screen.getByRole('textbox', {name: 'Caption word 1'});
    await userEvent.clear(word);
    await userEvent.type(word, 'Sceen');
    await userEvent.tab();
    expect(await within(screen.getByRole('group', {name: 'Caption words'})).findByRole('alert')).toBeInTheDocument();
    await userEvent.click(tab('Voice'));
    expect(wouldWarnOnLeaving()).toBe(true);
    // While it keeps failing, Generate stops with the reason.
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    expect(await screen.findByText('Some changes aren’t saved yet: Something failed on our side.')).toBeInTheDocument();
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
    // The server recovers: the next Generate sends the fix (from the hidden panel), then starts.
    failing.on = false;
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    expect(current.scenes[0].words[0].text).toBe('Sceen');
    await userEvent.click(tab('Text'));
    expect(screen.getByRole('textbox', {name: 'Caption word 1'})).toHaveValue('Sceen');
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });

  it('only the shown panel is visible to assistive technology', async () => {
    open();
    await loaded();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Visual');
    expect(screen.queryByRole('textbox', {name: 'Narration'})).not.toBeInTheDocument(); // hidden, not reachable
    for (const t of screen.getAllByRole('tab')) {
      const controls = t.getAttribute('aria-controls');
      expect(controls && document.getElementById(controls), `${t.textContent} controls a panel`).toBeTruthy();
    }
  });
});

describe('Reel editor round 3: Back to the script saves first (QF6-018)', () => {
  it('sends unsaved text, then opens the Script editor', async () => {
    const gate = holdFirstSceneSave();
    open();
    await loaded();
    await userEvent.type(screen.getByRole('textbox', {name: 'Visual prompt'}), ' kept');
    fireEvent.click(screen.getByRole('button', {name: 'Back to the script'}));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(screen.queryByTestId('where')).not.toBeInTheDocument(); // still waiting for the save
    await act(async () => gate.release());
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/script');
    expect(current.scenes[0].visualPrompt).toBe('prompt 1 kept');
  });

  it('a save that fails keeps the editor open with the reason', async () => {
    api.on('PATCH /scenes/:id', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    open();
    await loaded();
    await userEvent.type(screen.getByRole('textbox', {name: 'Visual prompt'}), ' lost?');
    await userEvent.click(screen.getByRole('button', {name: 'Back to the script'}));
    expect(await screen.findByText('Some changes aren’t saved yet: Something failed on our side.')).toBeInTheDocument();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: 'Visual prompt'})).toHaveValue('prompt 1 lost?');
  });
});

describe('Reel editor round 3: thumbnails and sliders (QF6-019, slider note)', () => {
  it('a scene thumbnail keeps its first link while the project is polled with new links', async () => {
    let sig = 0;
    current = readyProject({activeJobs: [job({type: 'visual', state: 'running'})]}, [readyScene(1), readyScene(2, {visualStatus: 'running'})]);
    api.on('GET /projects/:id', () => {
      sig += 1;
      const signedScenes = current.scenes.map((s) => (s.visual ? {...s, visual: {...s.visual, thumbnailUrl: `https://s3/t-${s.id}.jpg?sig=${sig}`}} : s));
      return {body: {project: {...current, scenes: signedScenes}}};
    });
    open();
    await loaded();
    const img = () => sceneButton(1).querySelector('img')!;
    const first = img().getAttribute('src');
    expect(first).toMatch(/\?sig=\d+$/);
    const polls = api.calls('GET /projects/:id').length;
    await waitFor(() => expect(api.calls('GET /projects/:id').length).toBeGreaterThan(polls), {timeout: 6000});
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(img().getAttribute('src')).toBe(first);
  }, 15_000);

  it('a slider save that fails is kept, still warns, and is sent again by the next Generate', async () => {
    const failing = {on: true};
    api.on('PATCH /projects/:id', (req) => {
      if (failing.on) return apiError(500, 'internal_error', 'Something failed on our side.');
      current = {...current, settings: {...current.settings, ...(req.body.settings ?? {})}, timelineVersion: current.timelineVersion + 1};
      return {body: {project: current, estimate: estimate()}};
    });
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 1, balance: 76}}));
    current = project({status: 'draft'}, [readyScene(1), scene(2)]);
    fakeClock();
    open();
    await loaded();
    fireEvent.change(screen.getByRole('slider', {name: 'Music volume'}), {target: {value: '0.4'}});
    await act(() => vi.advanceTimersByTimeAsync(700));
    const bar = screen.getByRole('region', {name: 'Audio and captions'});
    expect(await within(bar).findByRole('alert')).toHaveTextContent('Something failed on our side.');
    expect(screen.getByRole('slider', {name: 'Music volume'})).toHaveValue('0.4');
    expect(wouldWarnOnLeaving()).toBe(true);
    failing.on = false;
    fireEvent.click(screen.getByRole('button', {name: /Generate missing/}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    expect(current.settings.musicVolume).toBe(0.4);
    const sends = api.calls('PATCH /projects/:id').map((c) => c.body);
    expect(sends.filter((b) => b.settings?.musicVolume === 0.4).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });

  it('a slider save that fails is sent again when the editor is left', async () => {
    const failing = {on: true};
    api.on('PATCH /projects/:id', (req) => {
      if (failing.on) return apiError(500, 'internal_error', 'Something failed on our side.');
      current = {...current, settings: {...current.settings, ...(req.body.settings ?? {})}};
      return {body: {project: current, estimate: estimate()}};
    });
    fakeClock();
    const view = open();
    await loaded();
    fireEvent.change(screen.getByRole('slider', {name: 'Voice volume'}), {target: {value: '0.3'}});
    await act(() => vi.advanceTimersByTimeAsync(700));
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    failing.on = false;
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(500));
    await waitFor(() => expect(current.settings.voiceVolume).toBe(0.3));
  });
});
