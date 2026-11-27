import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Project, Scene} from '@/api/types';
import {apiError, credits, estimate, installFakeApi, job, project, scene, withBasics, type FakeApi} from '@/test/fakeApi';
import {ScriptEditorPage} from './ScriptEditorPage';

// Screen 10, Script editor (docs/SCREENS_F5_F6.md section 2; API B4, B5, B8-B11, C1-C6, G1, H1).
// The backend is a fake `fetch` that keeps one project and answers the scene endpoints.

let api: FakeApi;
let current: Project;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function open() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/p/${current.id}/script`]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <Routes>
          <Route path="/app/p/:id/script" element={<ScriptEditorPage />} />
          <Route path="/app/p/:id/edit" element={<Where />} />
          <Route path="/app/projects" element={<Where />} />
          <Route path="/app/new" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const words = (n: number) => Array.from({length: n}, (_, i) => `w${i}`).join(' ');
const sceneCard = (n: number) => screen.getByRole('article', {name: `Scene ${n}`});
const narration = (n: number) => screen.getByRole('textbox', {name: `Scene ${n} narration`});
const ready = () => screen.findByRole('textbox', {name: 'Scene 1 narration'});
const panel = () => screen.getByRole('complementary', {name: 'Summary'});
const patches = () => api.calls('PATCH /scenes/:id');

/** Fake timers that still let real time pass, so Testing Library's waits keep working. */
function fakeClock() {
  vi.useFakeTimers({shouldAdvanceTime: true});
  return userEvent.setup({advanceTimers: vi.advanceTimersByTime});
}
/** Moves the clock past the autosave delay (800 ms) and lets the resulting requests settle. */
const pastAutosave = () => act(() => vi.advanceTimersByTimeAsync(2000));

function serveProject() {
  api.on('GET /projects/:id', () => ({body: {project: current}}));
  api.on('GET /projects/:id/estimate', () => ({body: estimate(4, 77)}));
  api.on('PATCH /scenes/:id', (req, {id}) => {
    current = {...current, scenes: current.scenes.map((s) => (s.id === id ? ({...s, ...req.body} as Scene) : s))};
    return {body: {scene: current.scenes.find((s) => s.id === id), estimate: estimate()}};
  });
  api.on('PATCH /projects/:id', (req) => {
    current = {...current, ...req.body};
    return {body: {project: current, estimate: estimate()}};
  });
}

beforeEach(() => {
  api = installFakeApi();
  withBasics(api);
  current = project();
  serveProject();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- writing

describe('Script editor: while the script is written', () => {
  it('shows "Writing your script…" until the project is a draft, then the scenes', async () => {
    current = project({status: 'scripting', activeJobs: [job({type: 'script', state: 'running'})]}, []);
    open();
    expect(await screen.findByText('Writing your script…')).toBeInTheDocument();
    expect(screen.getByText('Writing your script…').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('button', {name: /generate reel/i})).toBeDisabled();
    expect(screen.getByRole('button', {name: /rewrite whole script/i})).toBeDisabled();
    const steps = screen.getByRole('list', {name: 'Steps'});
    expect(within(steps).getByText('Script').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    current = project();
    // B4 is polled every 2 s while the project is busy.
    expect(await screen.findByRole('textbox', {name: 'Scene 1 narration'}, {timeout: 5000})).toBeInTheDocument();
    expect(screen.queryByText('Writing your script…')).not.toBeInTheDocument();
  });

  it('while a whole-script rewrite runs, the old scenes stay visible but locked', async () => {
    current = project({status: 'scripting', activeJobs: [job({type: 'script', state: 'running'})]});
    open();
    await ready();
    expect(screen.getByText('Writing your script…')).toBeInTheDocument();
    expect(narration(1)).toBeDisabled();
    expect(within(sceneCard(1)).getByRole('combobox', {name: 'Scene 1 mood'})).toBeDisabled();
    expect(within(sceneCard(1)).getByRole('button', {name: 'More actions for scene 1'})).toBeDisabled();
    expect(screen.queryByRole('textbox', {name: 'New scene narration'})).not.toBeInTheDocument();
  });

  it('a script that failed says so and Try again rewrites it (B8)', async () => {
    current = project({status: 'draft'}, []);
    api.on('POST /projects/:id/script/regenerate', () => ({status: 202, body: {job: job({type: 'script'})}}));
    open();
    expect(await screen.findByText(/The script couldn't be written/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/script/regenerate')).toHaveLength(1));
  });

  // docs/SCREENS_F5_F6.md: "a failed script shows the reason and Try again". The reason is the
  // failed script job's error (API: job.error.message), available from G2 or G1.
  it('a script that failed shows the reason from its job', async () => {
    current = project({status: 'draft'}, []);
    const failed = job({
      id: 'script-job',
      type: 'script',
      projectId: 'p1',
      state: 'failed',
      creditsRefunded: true,
      error: {code: 'content_refused', message: 'The AI’s content rules refused this topic. Try wording it differently.'},
    });
    api.on('GET /projects/:id/jobs', () => ({body: {items: [failed], nextCursor: null}}));
    api.on('GET /jobs/:id', () => ({body: {job: failed}}));
    open();
    await screen.findByText(/The script couldn't be written/);
    expect(await screen.findByText(/content rules refused this topic/, {}, {timeout: 3000})).toBeInTheDocument();
  });

  it('an unknown project goes back to the projects list', async () => {
    api.on('GET /projects/:id', () => apiError(404, 'not_found', "We couldn't find that."));
    open();
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/projects');
  });
});

// ---------------------------------------------------------------- title and scenes

describe('Script editor: editing', () => {
  it('saves the title on Enter, and puts an empty title back without saving', async () => {
    open();
    const title = await screen.findByRole('textbox', {name: 'Title'});
    await userEvent.clear(title);
    await userEvent.type(title, 'Better title{enter}');
    await waitFor(() => expect(api.calls('PATCH /projects/:id')).toHaveLength(1));
    expect(api.calls('PATCH /projects/:id')[0].body).toEqual({title: 'Better title'});
    const again = screen.getByRole('textbox', {name: 'Title'});
    await userEvent.clear(again);
    await userEvent.tab();
    expect(screen.getByRole('textbox', {name: 'Title'})).toHaveValue('Better title');
    expect(api.calls('PATCH /projects/:id')).toHaveLength(1);
  });

  it('saves narration once after typing stops (debounced), shows Saving…, and updates the estimate', async () => {
    const user = fakeClock();
    let release: () => void = () => {};
    api.on('PATCH /scenes/:id', async (req, {id}) => {
      await new Promise<void>((r) => (release = r));
      current = {...current, scenes: current.scenes.map((s) => (s.id === id ? ({...s, ...req.body} as Scene) : s))};
      return {body: {scene: current.scenes.find((s) => s.id === id), estimate: estimate(9, 70)}};
    });
    open();
    await ready();
    await user.type(narration(1), ' More');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(patches()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(patches()).toHaveLength(1);
    expect(patches()[0]).toMatchObject({path: '/scenes/s1', body: {narration: 'Scene 1 narration goes here. More'}});
    expect(within(sceneCard(1)).getByText('Saving…')).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() => expect(within(sceneCard(1)).queryByText('Saving…')).not.toBeInTheDocument());
    expect(await within(panel()).findByText('9 credits')).toBeInTheDocument();
    await pastAutosave();
    expect(patches()).toHaveLength(1);
  });

  it('saves at once when the field loses focus, and not again afterwards', async () => {
    const user = fakeClock();
    open();
    await ready();
    await user.type(narration(2), '!');
    await user.tab();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({narration: 'Scene 2 narration goes here.!'});
    await pastAutosave();
    expect(patches()).toHaveLength(1);
  });

  it('keeps what is typed while an earlier save is still on its way', async () => {
    const user = fakeClock();
    let release: () => void = () => {};
    api.on('PATCH /scenes/:id', async (req, {id}) => {
      if (patches().length === 1) await new Promise<void>((r) => (release = r));
      current = {...current, scenes: current.scenes.map((s) => (s.id === id ? ({...s, ...req.body} as Scene) : s))};
      return {body: {scene: current.scenes.find((s) => s.id === id), estimate: estimate()}};
    });
    open();
    await ready();
    await user.type(narration(1), ' abc');
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(patches()).toHaveLength(1); // " abc" is on its way
    await user.type(narration(1), 'd'); // typed while it is still saving
    const fetchesBefore = api.calls('GET /projects/:id').length;
    await act(async () => release());
    // The save answers and the project is fetched again; the "d" must still be there.
    await waitFor(() => expect(api.calls('GET /projects/:id').length).toBeGreaterThan(fetchesBefore));
    await waitFor(() => expect(within(sceneCard(1)).queryByText('Saving…')).not.toBeInTheDocument());
    expect(narration(1)).toHaveValue('Scene 1 narration goes here. abcd');
    await pastAutosave();
    expect(narration(1)).toHaveValue('Scene 1 narration goes here. abcd');
    expect(current.scenes[0].narration).toBe('Scene 1 narration goes here. abcd');
  });

  it('saves on-screen text and mood; the mood menu lists the 10 moods', async () => {
    open();
    await ready();
    const onScreen = screen.getByRole('textbox', {name: 'Scene 1 on-screen text'});
    await userEvent.clear(onScreen);
    await userEvent.type(onScreen, 'BIG');
    await userEvent.tab();
    await waitFor(() => expect(patches().some((c) => c.path === '/scenes/s1' && c.body.onScreenText === 'BIG')).toBe(true));
    await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Scene 2 mood'}), 'tense');
    await waitFor(() => expect(patches().some((c) => c.path === '/scenes/s2' && c.body.mood === 'tense')).toBe(true));
    expect(screen.getByRole('combobox', {name: 'Scene 2 mood'})).toHaveValue('tense');
    expect(within(screen.getByRole('combobox', {name: 'Scene 1 mood'})).getAllByRole('option')).toHaveLength(10);
  });

  it('shows each scene’s time range, word count and estimated seconds', async () => {
    current = project({}, [scene(1, {narration: words(10)}), scene(2, {narration: words(25)})]);
    open();
    await ready();
    expect(within(sceneCard(1)).getByText('0:00–0:04')).toBeInTheDocument();
    expect(within(sceneCard(1)).getByText('10 words · 4s est.')).toBeInTheDocument();
    expect(within(sceneCard(2)).getByText('0:04–0:14')).toBeInTheDocument();
    expect(within(sceneCard(2)).getByText('25 words · 10s est.')).toBeInTheDocument();
  });

  it('warns about a scene over 15 s and an empty one, and never saves empty narration', async () => {
    const user = fakeClock();
    current = project({}, [scene(1, {narration: words(38)}), scene(2, {narration: words(20)})]);
    open();
    await ready();
    expect(within(sceneCard(1)).getByText(/Over 15 seconds/)).toBeInTheDocument();
    expect(within(sceneCard(2)).queryByText(/Over 15 seconds/)).not.toBeInTheDocument();
    await user.clear(narration(2));
    expect(within(sceneCard(2)).getByText('A scene needs some narration.')).toBeInTheDocument();
    await user.tab();
    await pastAutosave();
    expect(patches().filter((c) => c.body.narration === '')).toHaveLength(0);
    expect(narration(2)).toHaveValue(words(20));
  });

  // The spec now says under 2 s (FIX_LOG_F5, QF5-006 / BUG-049): hook scenes are often 3-5 s.
  it('warns about a scene under 2 s, and not at 2 s', async () => {
    current = project({}, [scene(1, {narration: words(4)}), scene(2, {narration: words(5)})]);
    open();
    await ready();
    expect(within(sceneCard(1)).getByText('4 words · 1.6s est.')).toBeInTheDocument();
    expect(within(sceneCard(1)).getByText('Under 2 seconds: it may flash by too fast to follow.')).toBeInTheDocument();
    expect(within(sceneCard(2)).queryByText(/Under 2 seconds/)).not.toBeInTheDocument();
  });

  it('shows a save error under the scene', async () => {
    api.on('PATCH /scenes/:id', () => apiError(400, 'validation_error', 'x', {fields: {narration: 'Use 1500 characters or fewer'}}));
    open();
    await ready();
    await userEvent.type(narration(1), 'x');
    await userEvent.tab();
    expect(await within(sceneCard(1)).findByRole('alert')).toHaveTextContent('Use 1500 characters or fewer');
  });
});

// ---------------------------------------------------------------- scene actions

describe('Script editor: scene actions', () => {
  it('rewrites a scene (C6) with its cost from H1, waits for the job and shows the new words', async () => {
    api.on('GET /credits', () => ({body: {...credits(), costs: {...credits().costs, rewrite: 2}}}));
    api.on('POST /scenes/:id/rewrite', () => ({status: 202, body: {job: job({id: 'rw', type: 'rewrite_scene'})}}));
    let polls = 0;
    api.on('GET /jobs/:id', () => {
      polls += 1;
      if (polls < 2) return {body: {job: job({id: 'rw', state: 'running'})}};
      current = {...current, scenes: current.scenes.map((s) => (s.id === 's1' ? {...s, narration: 'Punchier words.'} : s))};
      return {body: {job: job({id: 'rw', state: 'succeeded', output: {narration: 'Punchier words.', onScreenText: 'X'}})}};
    });
    open();
    await ready();
    await userEvent.click(within(sceneCard(1)).getByRole('button', {name: /^rewrite$/i}));
    await userEvent.type(screen.getByRole('textbox', {name: 'How should scene 1 change?'}), 'shorter');
    await userEvent.click(await within(sceneCard(1)).findByRole('button', {name: 'Rewrite · 2 credits'}));
    expect(await within(sceneCard(1)).findByText('Rewriting…')).toBeInTheDocument();
    await waitFor(() => expect(narration(1)).toHaveValue('Punchier words.'), {timeout: 5000});
    expect(api.calls('POST /scenes/:id/rewrite')[0]).toMatchObject({path: '/scenes/s1/rewrite', body: {instructions: 'shorter'}});
    expect(screen.queryByRole('textbox', {name: 'How should scene 1 change?'})).not.toBeInTheDocument();
  });

  it.each([
    ['a failed job', () => ({status: 202, body: {job: job({type: 'rewrite_scene'})}}), 'Refused by the content rules.'],
    [
      '402',
      () => apiError(402, 'insufficient_credits', 'x', {needed: 1, balance: 0, resetsAt: '2026-12-01T12:00:00Z'}),
      `This needs 1 credit and you have 0. Your credits renew on ${new Date('2026-12-01T12:00:00Z').toLocaleDateString(undefined, {day: 'numeric', month: 'long'})}.`,
    ],
  ])('a rewrite that fails (%s) shows its reason', async (_name, answer, text) => {
    api.on('POST /scenes/:id/rewrite', answer);
    api.on('GET /jobs/:id', () => ({
      body: {job: job({state: 'failed', error: {code: 'content_refused', message: 'Refused by the content rules.'}})},
    }));
    open();
    await ready();
    await userEvent.click(within(sceneCard(2)).getByRole('button', {name: /^rewrite$/i}));
    await userEvent.click(await within(sceneCard(2)).findByRole('button', {name: /Rewrite · 1 credit/}));
    expect(await within(sceneCard(2)).findByRole('alert')).toHaveTextContent(text);
  });

  it('moves a scene down and up from its menu (C5); the first and last are limited', async () => {
    api.on('POST /projects/:id/scenes/reorder', (req) => {
      const ids: string[] = req.body.sceneIds;
      current = {...current, scenes: ids.map((sid, i) => ({...current.scenes.find((s) => s.id === sid)!, position: i + 1}))};
      return {body: {scenes: current.scenes, estimate: estimate()}};
    });
    open();
    await ready();
    const menu = within(sceneCard(1)).getByRole('button', {name: 'More actions for scene 1'});
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', {name: 'Move up'})).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', {name: 'Move down'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/scenes/reorder')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/scenes/reorder')[0].body).toEqual({sceneIds: ['s2', 's1', 's3']});
    // The new order shows at once.
    expect(narration(2)).toHaveValue('Scene 1 narration goes here.');
    await userEvent.click(within(sceneCard(3)).getByRole('button', {name: 'More actions for scene 3'}));
    expect(screen.getByRole('menuitem', {name: 'Move down'})).toBeDisabled();
  });

  it('reorders with the keyboard alone (Tab to the menu, Enter, Move up)', async () => {
    api.on('POST /projects/:id/scenes/reorder', () => ({body: {scenes: [], estimate: estimate()}}));
    open();
    await ready();
    within(sceneCard(3)).getByRole('button', {name: /^rewrite$/i}).focus();
    await userEvent.tab();
    expect(within(sceneCard(3)).getByRole('button', {name: 'More actions for scene 3'})).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu', {name: 'Scene 3 actions'})).toBeInTheDocument();
    // Focus starts on the first available item.
    expect(screen.getByRole('menuitem', {name: 'Move up'})).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(api.calls('POST /projects/:id/scenes/reorder')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/scenes/reorder')[0].body).toEqual({sceneIds: ['s1', 's3', 's2']});
  });

  it('the scene menu can be closed with Escape (keyboard users)', async () => {
    open();
    await ready();
    const menu = within(sceneCard(2)).getByRole('button', {name: 'More actions for scene 2'});
    menu.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', {name: 'Move up'})).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(menu).toHaveFocus();
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('the first scene’s menu starts on Move down; a single scene’s on Duplicate (the first available item)', async () => {
    open();
    await ready();
    await userEvent.click(within(sceneCard(1)).getByRole('button', {name: 'More actions for scene 1'}));
    expect(screen.getByRole('menuitem', {name: 'Move down'})).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    cleanup();

    current = project({}, [scene(1)]);
    open();
    await ready();
    const only = within(sceneCard(1)).getByRole('button', {name: 'More actions for scene 1'});
    await userEvent.click(only);
    expect(screen.getByRole('menuitem', {name: 'Duplicate'})).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('pressing the menu button again closes the menu', async () => {
    open();
    await ready();
    const menu = within(sceneCard(2)).getByRole('button', {name: 'More actions for scene 2'});
    await userEvent.click(menu);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(menu);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('reorders by dragging a scene by its handle onto another', async () => {
    api.on('POST /projects/:id/scenes/reorder', () => ({body: {scenes: [], estimate: estimate()}}));
    open();
    await ready();
    const handle = within(sceneCard(3)).getByTitle('Drag to reorder');
    const target = sceneCard(1).parentElement!;
    fireEvent.dragStart(handle, {dataTransfer: {effectAllowed: '', setData: () => {}}});
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(() => expect(api.calls('POST /projects/:id/scenes/reorder')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/scenes/reorder')[0].body).toEqual({sceneIds: ['s3', 's1', 's2']});
  });

  it('a reorder the server refuses puts the old order back and says so', async () => {
    api.on('POST /projects/:id/scenes/reorder', () => apiError(400, 'validation_error', 'The order doesn’t match.'));
    open();
    await ready();
    await userEvent.click(within(sceneCard(1)).getByRole('button', {name: 'More actions for scene 1'}));
    await userEvent.click(screen.getByRole('menuitem', {name: 'Move down'}));
    expect(await screen.findByText('The order doesn’t match.')).toBeInTheDocument();
    await waitFor(() => expect(narration(1)).toHaveValue('Scene 1 narration goes here.'));
  });

  it('duplicates, and deletes only after confirming', async () => {
    api.on('POST /scenes/:id/duplicate', () => ({status: 201, body: {scene: scene(9), estimate: estimate()}}));
    api.on('DELETE /scenes/:id', () => ({status: 204}));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    open();
    await ready();
    await userEvent.click(within(sceneCard(2)).getByRole('button', {name: 'More actions for scene 2'}));
    await userEvent.click(screen.getByRole('menuitem', {name: 'Duplicate'}));
    await waitFor(() => expect(api.calls('POST /scenes/:id/duplicate')[0]?.path).toBe('/scenes/s2/duplicate'));
    for (let i = 0; i < 2; i++) {
      await userEvent.click(within(sceneCard(3)).getByRole('button', {name: 'More actions for scene 3'}));
      await userEvent.click(screen.getByRole('menuitem', {name: 'Delete'}));
    }
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith('Delete scene 3?');
    await waitFor(() => expect(api.calls('DELETE /scenes/:id')).toHaveLength(1));
    expect(api.calls('DELETE /scenes/:id')[0].path).toBe('/scenes/s3');
  }, 15_000);

  it('with one scene, Delete is disabled', async () => {
    current = project({}, [scene(1)]);
    open();
    await ready();
    await userEvent.click(within(sceneCard(1)).getByRole('button', {name: 'More actions for scene 1'}));
    expect(screen.getByRole('menuitem', {name: 'Delete'})).toBeDisabled();
  });

  it('adds a scene at the end (C1) and clears the box', async () => {
    api.on('POST /projects/:id/scenes', (req) => ({status: 201, body: {scene: scene(4, {narration: req.body.narration}), estimate: estimate()}}));
    open();
    await ready();
    expect(screen.getByText('3 of 30 scenes')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', {name: 'New scene narration'}), '  A brand new scene. {enter}');
    await waitFor(() => expect(api.calls('POST /projects/:id/scenes')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/scenes')[0].body).toEqual({narration: 'A brand new scene.'});
    expect(screen.getByRole('textbox', {name: 'New scene narration'})).toHaveValue('');
  });

  it('at 30 scenes adding is disabled', async () => {
    current = project({}, Array.from({length: 30}, (_, i) => scene(i + 1)));
    open();
    await screen.findByRole('textbox', {name: 'Scene 1 narration'}, {timeout: 10_000});
    expect(screen.getByText('30 of 30 scenes')).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: 'New scene narration'})).toBeDisabled();
    expect(screen.getByRole('button', {name: /add scene/i})).toBeDisabled();
  }, 20_000);
});

// ---------------------------------------------------------------- the panel

describe('Script editor: hooks, estimate, voice and the whole script', () => {
  it('suggests other openings (B9) and one click puts it in scene 1', async () => {
    api.on('POST /projects/:id/hooks', () => ({status: 202, body: {job: job({type: 'hooks'})}}));
    api.on('GET /jobs/:id', () => ({body: {job: job({state: 'succeeded', output: {hooks: ['Hook one.', 'Hook two.', 'Hook three.']}})}}));
    open();
    await ready();
    expect(within(sceneCard(2)).queryByRole('button', {name: /try another opening/i})).not.toBeInTheDocument();
    await userEvent.click(within(sceneCard(1)).getByRole('button', {name: /try another opening/i}));
    const list = await screen.findByRole('list', {name: 'Other openings'}, {timeout: 4000});
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    await userEvent.click(within(list).getByRole('button', {name: 'Hook two.'}));
    await waitFor(() => expect(patches().some((c) => c.path === '/scenes/s1' && c.body.narration === 'Hook two.')).toBe(true));
    await waitFor(() => expect(narration(1)).toHaveValue('Hook two.'));
    expect(screen.queryByRole('list', {name: 'Other openings'})).not.toBeInTheDocument();
  });

  it('a hooks request that is refused (409 no_script) shows the message', async () => {
    api.on('POST /projects/:id/hooks', () => apiError(409, 'no_script', 'Write the script first.'));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /try another opening/i}));
    expect(await screen.findByText('Write the script first.')).toBeInTheDocument();
  });

  it('shows the length against the target, words, scenes and the generating estimate (B10)', async () => {
    current = project({targetSeconds: 15}, [scene(1, {narration: words(30)}), scene(2, {narration: words(20)})]);
    open();
    await ready();
    expect(within(panel()).getByText('20.0s')).toBeInTheDocument();
    expect(within(panel()).getByText(/Target 15s · over the target/)).toBeInTheDocument();
    expect(within(panel()).getByText('50')).toBeInTheDocument();
    expect(await within(panel()).findByText('4 credits')).toBeInTheDocument();
    expect(within(panel()).getByText(/77 credits left/)).toBeInTheDocument();
    expect(api.calls('GET /projects/:id/estimate')[0].path).toBe('/projects/p1/estimate');
  });

  it('warns when the Reel is over 90 s', async () => {
    current = project({targetSeconds: 90}, [scene(1, {narration: words(240)})]);
    open();
    await ready();
    expect(screen.getByText(/over 90 s can’t be rendered/)).toBeInTheDocument();
  });

  it('changes the project voice (B5) and shows the new estimate', async () => {
    api.on('PATCH /projects/:id', (req) => {
      current = {...current, ...req.body};
      return {body: {project: current, estimate: estimate(6, 77)}};
    });
    open();
    await ready();
    const picker = screen.getByRole('combobox', {name: /narrator/i});
    await waitFor(() => expect(picker).toHaveValue('v-laura'));
    await userEvent.selectOptions(picker, 'v-george');
    await waitFor(() => expect(api.calls('PATCH /projects/:id')[0]?.body).toEqual({voiceId: 'v-george'}));
    expect(await within(panel()).findByText('6 credits')).toBeInTheDocument();
    expect(picker).toHaveValue('v-george');
  });

  it('rewrites the whole script (B8) with optional instructions, after confirming, and shows the cost', async () => {
    api.on('POST /projects/:id/script/regenerate', () => {
      current = {...current, status: 'scripting', activeJobs: [job({type: 'script', state: 'running'})]};
      return {status: 202, body: {job: job({type: 'script'})}};
    });
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /rewrite whole script/i}));
    expect(screen.getByText(/Every scene is replaced\. 1 credit\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    expect(api.calls('POST /projects/:id/script/regenerate')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', {name: /rewrite whole script/i}));
    await userEvent.type(screen.getByRole('textbox', {name: 'What should change'}), 'funnier');
    await userEvent.click(screen.getByRole('button', {name: 'Write a new script'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/script/regenerate')[0]?.body).toEqual({instructions: 'funnier'}));
    expect(await screen.findByText('Writing your script…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- Generate

describe('Script editor: Generate Reel (B11)', () => {
  it('sends an Idempotency-Key and opens the Reel editor', async () => {
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/edit');
    const call = api.calls('POST /projects/:id/generate')[0];
    expect(call.path).toBe('/projects/p1/generate');
    expect(call.headers['Idempotency-Key']).toMatch(/^[\w:.-]{1,100}$/);
    expect(call.body).toEqual({});
  });

  it.each([
    [apiError(402, 'insufficient_credits', 'x', {needed: 9, balance: 2}), 'This needs 9 credits and you have 2.'],
    [apiError(503, 'provider_unavailable', 'The AI service is not available right now.'), 'The AI service is not available right now.'],
    [apiError(409, 'already_running', 'This is already in progress.'), 'This is already in progress.'],
  ])('shows the error and stays: %#', async (answer, text) => {
    api.on('POST /projects/:id/generate', () => answer);
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    expect(await screen.findByText(new RegExp(text.replace(/[.?]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('each click sends a different key', async () => {
    api.on('POST /projects/:id/generate', () => apiError(503, 'provider_unavailable', 'Not now.'));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    await screen.findByText('Not now.');
    await userEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(2));
    const [a, b] = api.calls('POST /projects/:id/generate');
    expect(a.headers['Idempotency-Key']).not.toBe(b.headers['Idempotency-Key']);
  });
});

// ---------------------------------------------------------------- round 2 (FIX_LOG_F5)

/** Fires the browser's "leave page?" check and says whether the page asked to stay. */
function wouldWarnOnLeaving(): boolean {
  const event = new Event('beforeunload', {cancelable: true});
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** PATCH /scenes/:id answers only when `release()` is called; later saves answer at once. */
function holdFirstSceneSave(fail = false) {
  const gate: {release: () => void} = {release: () => {}};
  let n = 0;
  api.on('PATCH /scenes/:id', async (req, {id}) => {
    n += 1;
    if (n === 1) await new Promise<void>((r) => (gate.release = r));
    if (fail) return apiError(500, 'internal_error', 'Something failed on our side.');
    current = {...current, scenes: current.scenes.map((s) => (s.id === id ? ({...s, ...req.body} as Scene) : s))};
    return {body: {scene: current.scenes.find((s) => s.id === id), estimate: estimate()}};
  });
  return gate;
}

const indexOf = (method: string, path: RegExp) => api.requests.findIndex((r) => r.method === method && path.test(r.path));

describe('Script editor: autosave (round 2)', () => {
  it('sends a scene’s edits one at a time, in order; the latest text is saved last', async () => {
    const user = fakeClock();
    const gate = holdFirstSceneSave();
    open();
    await ready();
    await user.type(narration(1), ' a');
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(patches()).toHaveLength(1);
    await user.type(narration(1), 'b');
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(patches()).toHaveLength(1); // waits for the first answer
    await act(async () => gate.release());
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches().map((c) => c.body.narration)).toEqual([
      'Scene 1 narration goes here. a',
      'Scene 1 narration goes here. ab',
    ]);
    await waitFor(() => expect(current.scenes[0].narration).toBe('Scene 1 narration goes here. ab'));
    expect(narration(1)).toHaveValue('Scene 1 narration goes here. ab');
  });

  it('says Saved once the edit has landed, as a status message', async () => {
    open();
    await ready();
    await userEvent.type(narration(2), '!');
    await userEvent.tab();
    const saved = await within(sceneCard(2)).findByText('Saved');
    expect(saved).toHaveAttribute('role', 'status');
  });

  it('warns before leaving the tab while an edit is unsaved, and not after it has landed', async () => {
    const gate = holdFirstSceneSave();
    open();
    await ready();
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
    await userEvent.type(narration(1), '!');
    expect(wouldWarnOnLeaving()).toBe(true);
    await userEvent.tab(); // the save starts but is held
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(wouldWarnOnLeaving()).toBe(true);
    await act(async () => gate.release());
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });

  it('sends unsaved text when the editor is left before the autosave delay', async () => {
    const view = open();
    await ready();
    await userEvent.type(narration(2), ' kept');
    expect(patches()).toHaveLength(0);
    view.unmount();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({path: '/scenes/s2', body: {narration: 'Scene 2 narration goes here. kept'}});
  });

  it('Generate waits until unsaved text has been saved, then generates', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.type(narration(1), ' last words');
    // A click that does not move focus, so only Generate itself can send the text.
    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
    await act(async () => gate.release());
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/edit');
    expect(indexOf('PATCH', /^\/scenes\/s1$/)).toBeLessThan(indexOf('POST', /\/generate$/));
    expect(patches()[0].body).toEqual({narration: 'Scene 1 narration goes here. last words'});
  });

  it('a scene rewrite and Rewrite whole script also send unsaved text first', async () => {
    api.on('POST /scenes/:id/rewrite', () => ({status: 202, body: {job: job({id: 'rw'})}}));
    api.on('GET /jobs/:id', () => ({body: {job: job({id: 'rw', state: 'succeeded', output: {narration: 'x', onScreenText: 'x'}})}}));
    api.on('POST /projects/:id/script/regenerate', () => ({status: 202, body: {job: job({id: 'b8', type: 'script'})}}));
    open();
    await ready();
    await userEvent.type(narration(2), ' two');
    fireEvent.click(within(sceneCard(2)).getByRole('button', {name: /^rewrite$/i}));
    fireEvent.click(await within(sceneCard(2)).findByRole('button', {name: /Rewrite · 1 credit/}));
    await waitFor(() => expect(api.calls('POST /scenes/:id/rewrite')).toHaveLength(1));
    expect(indexOf('PATCH', /^\/scenes\/s2$/)).toBeGreaterThanOrEqual(0);
    expect(indexOf('PATCH', /^\/scenes\/s2$/)).toBeLessThan(indexOf('POST', /^\/scenes\/s2\/rewrite$/));

    await userEvent.type(narration(3), ' three');
    fireEvent.click(screen.getByRole('button', {name: /rewrite whole script/i}));
    fireEvent.click(screen.getByRole('button', {name: 'Write a new script'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/script/regenerate')).toHaveLength(1));
    expect(indexOf('PATCH', /^\/scenes\/s3$/)).toBeGreaterThanOrEqual(0);
    expect(indexOf('PATCH', /^\/scenes\/s3$/)).toBeLessThan(indexOf('POST', /\/script\/regenerate$/));
  });

  // After a save fails, the text in the box is still not on the server.
  it('after a failed save the edit still counts as unsaved: leaving warns, and Generate does not use the old text', async () => {
    const gate = holdFirstSceneSave(true);
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.type(narration(1), ' unsaved');
    await userEvent.tab();
    await act(async () => gate.release());
    expect(await within(sceneCard(1)).findByRole('alert')).toHaveTextContent('Something failed on our side.');
    expect(narration(1)).toHaveValue('Scene 1 narration goes here. unsaved');
    expect(wouldWarnOnLeaving(), 'leaving warns while the text is unsaved').toBe(true);

    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    await waitFor(() => expect(api.calls('POST /projects/:id/generate').length + patches().length).toBeGreaterThan(1));
    // Either the text is sent again before generating, or Generate does not start.
    const generated = indexOf('POST', /\/generate$/);
    if (generated >= 0) {
      const sent = api.requests.map((r, i) => ({r, i})).filter(({r}) => r.method === 'PATCH' && r.path === '/scenes/s1');
      expect(sent.filter(({i}) => i < generated).length, 'saves of the text before Generate').toBeGreaterThan(1);
    }
  });
});

describe('Script editor: failures and shortening (round 2)', () => {
  it('a failed first script shows its reason (G2) and links to New Reel with the topic, mode and length', async () => {
    current = project({status: 'draft', topic: 'morning habits', mode: 'full_ai', targetSeconds: 60}, []);
    api.on('GET /projects/:id/jobs', () => ({
      body: {
        items: [job({id: 'sj', type: 'script', state: 'failed', error: {code: 'content_refused', message: 'The AI refused this topic.'}})],
        nextCursor: null,
      },
    }));
    open();
    expect(
      await screen.findByText(/The script couldn't be written: The AI refused this topic\. Your credit was refunded\./),
    ).toBeInTheDocument();
    expect(api.calls('GET /projects/:id/jobs')[0].path).toMatch(/^\/projects\/p1\/jobs/);
    const link = screen.getByRole('link', {name: 'change the topic'});
    const href = new URL(link.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe('/app/new');
    expect(Object.fromEntries(href.searchParams)).toEqual({topic: 'morning habits', mode: 'full_ai', length: '60'});
    await userEvent.click(link);
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/new');
  });

  it('a whole-script rewrite that fails during this visit says why, and that the scenes are unchanged', async () => {
    const failed = job({id: 'b8', type: 'script', state: 'failed', error: {code: 'provider_failed', message: 'The AI service didn’t answer.'}});
    let rewriting = false;
    api.on('POST /projects/:id/script/regenerate', () => {
      rewriting = true;
      current = {...current, status: 'scripting', activeJobs: [job({id: 'b8', type: 'script', state: 'running'})]};
      return {status: 202, body: {job: job({id: 'b8', type: 'script'})}};
    });
    api.on('GET /projects/:id', () => {
      const answer = current;
      if (rewriting && current.status === 'scripting') current = {...current, status: 'draft', activeJobs: []};
      return {body: {project: answer}};
    });
    api.on('GET /projects/:id/jobs', () => ({body: {items: rewriting && current.status === 'draft' ? [failed] : [], nextCursor: null}}));
    // Round 3: the page waits on the job B8 returned (G1) and reads its result there.
    api.on('GET /jobs/:id', (_req, {id}) => ({body: {job: id === 'b8' ? failed : job({id})}}));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /rewrite whole script/i}));
    await userEvent.click(screen.getByRole('button', {name: 'Write a new script'}));
    expect(
      await screen.findByText(/A new script couldn't be written: The AI service didn’t answer\. Your scenes are unchanged/, {}, {timeout: 6000}),
    ).toBeInTheDocument();
    expect(narration(1)).toHaveValue('Scene 1 narration goes here.');
  }, 15_000);

  // Seen on the real backend: a failing B8 job ends in about 0.1 s, and the project is never seen
  // "scripting" (it stays a draft with no active job), so the screen must still say why.
  it('a whole-script rewrite that has already failed by the next project fetch is still reported', async () => {
    const failed = job({id: 'b8', type: 'script', state: 'failed', error: {code: 'provider_failed', message: 'The AI service didn’t answer.'}});
    let rewritten = false;
    api.on('POST /projects/:id/script/regenerate', () => {
      rewritten = true;
      return {status: 202, body: {job: job({id: 'b8', type: 'script'})}};
    });
    api.on('GET /jobs/:id', () => ({body: {job: failed}}));
    api.on('GET /projects/:id/jobs', () => ({body: {items: rewritten ? [failed] : [], nextCursor: null}}));
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', {name: /rewrite whole script/i}));
    await userEvent.click(screen.getByRole('button', {name: 'Write a new script'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/script/regenerate')).toHaveLength(1));
    expect(
      await screen.findByText(/A new script couldn't be written: The AI service didn’t answer\. Your scenes are unchanged/, {}, {timeout: 6000}),
    ).toBeInTheDocument();
  }, 15_000);

  it('an older failed script job does not show the rewrite notice on a script that has scenes', async () => {
    api.on('GET /projects/:id/jobs', () => ({
      body: {items: [job({id: 'old', type: 'script', state: 'failed', error: {code: 'provider_failed', message: 'Old failure.'}})], nextCursor: null},
    }));
    open();
    await ready();
    await waitFor(() => expect(api.calls('GET /projects/:id/jobs').length).toBeGreaterThan(0));
    expect(screen.queryByText(/couldn't be written/)).not.toBeInTheDocument();
  });

  it('"Shorten with AI" appears over 115% of the target and asks B8 to fit the target', async () => {
    api.on('POST /projects/:id/script/regenerate', () => ({status: 202, body: {job: job({type: 'script'})}}));
    // 50 words = 20 s against a 15 s target (133%).
    current = project({targetSeconds: 15}, [scene(1, {narration: words(30)}), scene(2, {narration: words(20)})]);
    open();
    await ready();
    await userEvent.click(within(panel()).getByRole('button', {name: 'Shorten with AI · 1 credit'}));
    await waitFor(() => expect(api.calls('POST /projects/:id/script/regenerate')).toHaveLength(1));
    expect(api.calls('POST /projects/:id/script/regenerate')[0].body.instructions).toMatch(/15 seconds/);
  });

  it('"Shorten with AI" is not offered within 115% of the target', async () => {
    // 42 words = 16.8 s against a 15 s target (112%).
    current = project({targetSeconds: 15}, [scene(1, {narration: words(25)}), scene(2, {narration: words(17)})]);
    open();
    await ready();
    expect(within(panel()).getByText('16.8s')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Shorten with AI/})).not.toBeInTheDocument();
  });

  it('the title being typed is not replaced by a title from the server', async () => {
    // A running job keeps the project polled every 2 s.
    current = project({activeJobs: [job({type: 'hooks', state: 'running'})]});
    open();
    const title = await screen.findByRole('textbox', {name: 'Title'});
    await userEvent.clear(title);
    await userEvent.type(title, 'My own title');
    const before = api.calls('GET /projects/:id').length;
    current = {...current, title: 'A title from the server'};
    await waitFor(() => expect(api.calls('GET /projects/:id').length).toBeGreaterThan(before), {timeout: 5000});
    expect(title).toHaveValue('My own title');
    await userEvent.tab();
    await waitFor(() => expect(api.calls('PATCH /projects/:id')[0]?.body).toEqual({title: 'My own title'}));
  });

  it('shows the credits and channel pills, and has no second main landmark', async () => {
    open();
    await ready();
    expect(await screen.findByRole('link', {name: /credits left$/})).toBeInTheDocument();
    // F7: the demo account has a connected channel, so its pill shows.
    expect(screen.getAllByRole('link').some((l) => l.getAttribute('href') === '/app/settings?tab=youtube')).toBe(true);
    expect(screen.queryByRole('main')).not.toBeInTheDocument(); // the app shell owns <main>
    expect(screen.getByRole('region', {name: 'Script storyboard'})).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- round 3 (FIX_LOG_F5, Round 3)

/** PATCH /scenes/:id fails while `failing.on` is true, and saves normally after. */
function flakySceneSaves() {
  const failing = {on: true};
  api.on('PATCH /scenes/:id', (req, {id}) => {
    if (failing.on) return apiError(500, 'internal_error', 'Something failed on our side.');
    current = {...current, scenes: current.scenes.map((s) => (s.id === id ? ({...s, ...req.body} as Scene) : s))};
    return {body: {scene: current.scenes.find((s) => s.id === id), estimate: estimate()}};
  });
  return failing;
}

// QF5-022: the message names the scene's own reason; flakySceneSaves answers 500 with this message.
const NOT_SAVED = 'Some changes aren’t saved yet: Something failed on our side.';

describe('Script editor: a save that fails (round 3)', () => {
  it('shows the error and never "Saved"; the next blur sends the same text again', async () => {
    const failing = flakySceneSaves();
    open();
    await ready();
    await userEvent.type(narration(1), ' again');
    await userEvent.tab();
    expect(await within(sceneCard(1)).findByRole('alert')).toHaveTextContent('Something failed on our side.');
    expect(within(sceneCard(1)).queryByText('Saved')).not.toBeInTheDocument();
    expect(wouldWarnOnLeaving()).toBe(true);

    failing.on = false;
    await userEvent.click(narration(1));
    await userEvent.tab();
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches().map((c) => c.body.narration)).toEqual([
      'Scene 1 narration goes here. again',
      'Scene 1 narration goes here. again',
    ]);
    expect(await within(sceneCard(1)).findByText('Saved')).toBeInTheDocument();
    expect(within(sceneCard(1)).queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });

  it('Generate tries the save again, and stops with "Some changes aren’t saved yet…" if it still fails', async () => {
    flakySceneSaves();
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.type(narration(1), ' x');
    await userEvent.tab();
    await within(sceneCard(1)).findByRole('alert');
    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    expect(await within(panel()).findByText(NOT_SAVED)).toBeInTheDocument();
    expect(patches()).toHaveLength(2); // tried again
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    expect(wouldWarnOnLeaving()).toBe(true);
  });

  it('Generate goes ahead once the retried save succeeds', async () => {
    const failing = flakySceneSaves();
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.type(narration(1), ' y');
    await userEvent.tab();
    await within(sceneCard(1)).findByRole('alert');
    failing.on = false;
    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/edit');
    expect(current.scenes[0].narration).toBe('Scene 1 narration goes here. y');
  });

  it('a scene rewrite and Rewrite whole script also stop while a save keeps failing', async () => {
    flakySceneSaves();
    api.on('POST /scenes/:id/rewrite', () => ({status: 202, body: {job: job()}}));
    api.on('POST /projects/:id/script/regenerate', () => ({status: 202, body: {job: job({type: 'script'})}}));
    open();
    await ready();
    await userEvent.type(narration(2), ' z');
    await userEvent.tab();
    await within(sceneCard(2)).findByRole('alert');

    await userEvent.click(within(sceneCard(2)).getByRole('button', {name: /^rewrite$/i}));
    await userEvent.click(await within(sceneCard(2)).findByRole('button', {name: /Rewrite · 1 credit/}));
    await waitFor(() => expect(within(sceneCard(2)).getByRole('alert')).toHaveTextContent(NOT_SAVED));
    expect(api.calls('POST /scenes/:id/rewrite')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', {name: /rewrite whole script/i}));
    await userEvent.click(screen.getByRole('button', {name: 'Write a new script'}));
    expect(await within(panel()).findByText(NOT_SAVED)).toBeInTheDocument();
    expect(api.calls('POST /projects/:id/script/regenerate')).toHaveLength(0);
  });

  it('a scene removed while its text is unsaved stops counting once its last save ends', async () => {
    flakySceneSaves();
    api.on('DELETE /scenes/:id', (_req, {id}) => {
      current = {...current, scenes: current.scenes.filter((s) => s.id !== id)};
      return {status: 204};
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open();
    await ready();
    await userEvent.type(narration(3), ' gone');
    await userEvent.tab();
    await within(sceneCard(3)).findByRole('alert');
    expect(wouldWarnOnLeaving()).toBe(true);
    await userEvent.click(within(sceneCard(3)).getByRole('button', {name: 'More actions for scene 3'}));
    await userEvent.click(screen.getByRole('menuitem', {name: 'Delete'}));
    await waitFor(() => expect(screen.queryByRole('article', {name: 'Scene 3'})).not.toBeInTheDocument());
    await waitFor(() => expect(wouldWarnOnLeaving()).toBe(false));
  });
});

describe('Script editor: why unsaved edits stop an action (round 4, QF5-022)', () => {
  it('a save refused with 400 stops Generate with the API’s own message', async () => {
    api.on('PATCH /scenes/:id', () =>
      apiError(400, 'validation_error', 'Some details need another look.', {fields: {narration: 'Use 1500 characters or fewer'}}),
    );
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.type(narration(1), ' too long');
    await userEvent.tab();
    expect(await within(sceneCard(1)).findByRole('alert')).toHaveTextContent('Use 1500 characters or fewer');
    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    expect(
      await within(panel()).findByText('Some changes aren’t saved yet: Use 1500 characters or fewer'),
    ).toBeInTheDocument();
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
  });

  it('a save lost to the connection stops Generate with the connection message', async () => {
    api.on('PATCH /scenes/:id', () => {
      throw new TypeError('Failed to fetch'); // fetch itself fails: no answer at all
    });
    open();
    await ready();
    await userEvent.type(narration(1), ' offline');
    await userEvent.tab();
    const reason = (await within(sceneCard(1)).findByRole('alert')).textContent!;
    expect(reason).toMatch(/connection/i);
    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    expect(await within(panel()).findByText(`Some changes aren’t saved yet: ${reason}`)).toBeInTheDocument();
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(0);
  });
});

describe('Script editor: round 3', () => {
  it('Generate is busy from the first click: a double click starts it once', async () => {
    const gate = holdFirstSceneSave();
    api.on('POST /projects/:id/generate', () => ({status: 202, body: {jobs: [], creditsReserved: 4, balance: 73}}));
    open();
    await ready();
    await userEvent.type(narration(1), ' twice');
    const button = screen.getByRole('button', {name: /generate reel/i});
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(patches()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', {name: /generate reel/i}));
    await act(async () => gate.release());
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/p/p1/edit');
    expect(api.calls('POST /projects/:id/generate')).toHaveLength(1);
  });

  it('a hooks wait started by a click stops asking when the page is left', async () => {
    const user = fakeClock();
    api.on('POST /projects/:id/hooks', () => ({status: 202, body: {job: job({id: 'hk', type: 'hooks'})}}));
    api.on('GET /jobs/:id', (_req, {id}) => ({body: {job: job({id, state: 'running'})}}));
    const view = open();
    await ready();
    await user.click(screen.getByRole('button', {name: /try another opening/i}));
    await waitFor(() => expect(api.calls('GET /jobs/:id')).toHaveLength(1));
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.calls('GET /jobs/:id')).toHaveLength(1);
  });

  it('a scene rewrite wait stops asking when the page is left', async () => {
    const user = fakeClock();
    api.on('POST /scenes/:id/rewrite', () => ({status: 202, body: {job: job({id: 'rw'})}}));
    api.on('GET /jobs/:id', (_req, {id}) => ({body: {job: job({id, state: 'running'})}}));
    const view = open();
    await ready();
    await user.click(within(sceneCard(1)).getByRole('button', {name: /^rewrite$/i}));
    await user.click(await within(sceneCard(1)).findByRole('button', {name: /Rewrite · 1 credit/}));
    await waitFor(() => expect(api.calls('GET /jobs/:id')).toHaveLength(1));
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.calls('GET /jobs/:id')).toHaveLength(1);
  });

  it('warns "Very short" when the whole script is under 5 s, and not at 5 s', async () => {
    current = project({}, [scene(1, {narration: words(10)})]); // 4 s
    const view = open();
    await ready();
    expect(within(panel()).getByText(/Very short: under 5 seconds/)).toBeInTheDocument();
    view.unmount();
    current = project({}, [scene(1, {narration: words(13)})]); // 5.2 s
    open();
    await ready();
    expect(within(panel()).queryByText(/Very short/)).not.toBeInTheDocument();
  });

  it('with no scenes yet, the summary shows no stray "0"', async () => {
    current = project({status: 'scripting', activeJobs: [job({type: 'script', state: 'running'})]}, []);
    open();
    await screen.findByText('Writing your script…');
    const lengthBlock = within(panel()).getByText('Estimated length').parentElement!.parentElement!;
    const strayText = Array.from(lengthBlock.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .filter(Boolean);
    expect(strayText).toEqual([]);
  });
});
