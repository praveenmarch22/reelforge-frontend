import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {StrictMode} from 'react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {User} from '@/api/types';
import {apiError, installFakeApi, job, project, user, VOICES, withBasics, type FakeApi} from '@/test/fakeApi';
import {NewReelPage} from './NewReelPage';

// Screen 9, New Reel (docs/SCREENS_F5_F6.md section 1; API B1, B3, D3, G1, H1). The backend is a
// fake `fetch` (src/test/fakeApi.ts): each test says how the endpoints it uses answer.

let api: FakeApi;

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

/**
 * Opens the screen. In the app the AppShell has already loaded the signed-in user before this
 * screen mounts, so `signedIn` puts that user in the cache first, as the app does.
 */
function open(path = '/app/new', signedIn?: User, {strict = false} = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  if (signedIn) client.setQueryData(['me'], signedIn);
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <Routes>
          <Route path="/app/new" element={<NewReelPage />} />
          <Route path="/app/p/:id/script" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
const openView = open;

const box = () => screen.getByRole('textbox', {name: /what is your reel about|your script/i});
const writeScript = () => screen.getByRole('button', {name: /write script/i});
const chip = (name: string) => screen.getByRole('button', {name});
const pasteSwitch = () => screen.getByRole('checkbox', {name: /paste my own script/i});

function acceptProjects() {
  api.on('POST /projects', () => ({
    status: 202,
    body: {project: project({id: 'p9', status: 'scripting'}, []), job: job({type: 'script'})},
  }));
}

beforeEach(() => {
  api = installFakeApi();
  withBasics(api, {balance: 42});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('New Reel: the prompt box', () => {
  it('counts characters up to 300 for a topic and 5000 for a pasted script', async () => {
    open();
    expect(box()).toHaveAttribute('maxLength', '300');
    await userEvent.type(box(), 'Five habits');
    expect(screen.getByText('11 / 300')).toBeInTheDocument();
    await userEvent.click(pasteSwitch());
    expect(box()).toHaveAccessibleName('Your script');
    expect(box()).toHaveAttribute('maxLength', '5000');
    expect(screen.getByText('0 / 5000')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /get ideas/i})).toBeDisabled();
    // Switching back keeps the topic that was typed.
    await userEvent.click(pasteSwitch());
    expect(box()).toHaveValue('Five habits');
  });

  it('line breaks typed or pasted into the topic become spaces; a pasted script keeps them', async () => {
    acceptProjects();
    open();
    await userEvent.type(box(), 'Five{enter}money habits');
    expect(box()).toHaveValue('Five money habits');
    await userEvent.click(box());
    await userEvent.paste('\r\nfor students');
    expect(box()).toHaveValue('Five money habits for students');
    await userEvent.click(pasteSwitch());
    await userEvent.type(box(), 'One.{enter}Two.');
    expect(box()).toHaveValue('One.\nTwo.');
  });

  it('shows the credits and the YouTube channel pills in the top bar (F7: YouTube first)', async () => {
    const me = user({
      connections: {youtube: {status: 'connected', name: 'Asha Shorts', pictureUrl: null, connectedAt: null}, instagram: null},
    });
    open('/app/new', me);
    expect(
      screen.getByRole('link', {name: `${me.credits.balance} of ${me.credits.monthlyAllowance} credits left`}),
    ).toBeInTheDocument();
    const channel = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/app/settings?tab=youtube');
    expect(channel).toHaveTextContent('Asha Shorts');
  });

  it('an empty topic or script is refused before anything is sent, and the error is tied to the box', async () => {
    open();
    await waitFor(() => expect(api.calls('GET /me')).not.toHaveLength(0));
    await userEvent.click(writeScript());
    expect(screen.getByText('Write what your Reel is about')).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveAccessibleDescription(/Write what your Reel is about/);
    await userEvent.click(pasteSwitch());
    await userEvent.type(box(), '   ');
    await userEvent.click(writeScript());
    expect(screen.getByText('Paste your script')).toBeInTheDocument();
    expect(api.calls('POST /projects')).toHaveLength(0);
  });

  it('sends the topic with tone, length, mode and voice, then opens the script editor', async () => {
    acceptProjects();
    open();
    expect(screen.getByRole('list', {name: 'Steps'})).toBeInTheDocument();
    expect(screen.getByText('Idea').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    await userEvent.type(box(), '  Five money habits  ');
    await userEvent.click(chip('Funny'));
    await userEvent.click(chip('60s'));
    await userEvent.click(chip('Full AI'));
    expect(screen.getByText(/AI images with slow motion/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', {name: /narrator/i})).toBeEnabled());
    await userEvent.selectOptions(screen.getByRole('combobox', {name: /narrator/i}), 'v-george');
    expect(chip('Funny')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Educational')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('30s')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(writeScript());
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/app/p/p9/script'));
    expect(api.calls('POST /projects')[0].body).toEqual({
      topic: 'Five money habits',
      tone: 'funny',
      mode: 'full_ai',
      targetSeconds: 60,
      voiceId: 'v-george',
    });
  });

  it('a pasted script is sent as `script`, not `topic`, with its paragraphs kept', async () => {
    acceptProjects();
    open();
    await userEvent.click(pasteSwitch());
    await userEvent.type(box(), 'First paragraph.{enter}{enter}Second paragraph.');
    await userEvent.click(writeScript());
    await waitFor(() => expect(api.calls('POST /projects')).toHaveLength(1));
    const body = api.calls('POST /projects')[0].body;
    expect(body.script).toBe('First paragraph.\n\nSecond paragraph.');
    expect(body).not.toHaveProperty('topic');
  });

  it('starts from the account defaults: mode and narrator', async () => {
    const me = user({defaults: {voiceId: 'v-george', captionStyle: 'bold-pop', mode: 'full_ai'}});
    api.on('GET /me', () => ({body: {user: me}}));
    acceptProjects();
    open('/app/new', me);
    expect(chip('Full AI')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('combobox', {name: /narrator/i})).toHaveValue('v-george'));
    await userEvent.type(box(), 'Topic');
    await userEvent.click(writeScript());
    await waitFor(() => expect(api.calls('POST /projects')).toHaveLength(1));
    expect(api.calls('POST /projects')[0].body).toMatchObject({mode: 'full_ai', voiceId: 'v-george'});
  });

  it('plays the narrator sample and stops it on a second click', async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const made: string[] = [];
    vi.stubGlobal(
      'Audio',
      class {
        constructor(url: string) {
          made.push(url);
        }
        play = play;
        pause = pause;
        addEventListener() {}
      },
    );
    open('/app/new', user({defaults: {voiceId: VOICES[0].id, captionStyle: 'bold-pop', mode: 'faceless'}}));
    const playButton = await screen.findByRole('button', {name: `Play ${VOICES[0].name} sample`});
    await userEvent.click(playButton);
    expect(made).toEqual([VOICES[0].previewUrl]);
    expect(play).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', {name: `Stop ${VOICES[0].name}'s sample`}));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('button', {name: `Play ${VOICES[0].name} sample`})).toBeInTheDocument();
  });
});

describe('New Reel: arriving from the dashboard', () => {
  it('fills the topic, length and mode from the address', async () => {
    open('/app/new?topic=Morning%20routine&mode=full_ai&length=90');
    expect(box()).toHaveValue('Morning routine');
    expect(chip('90s')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Full AI')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Faceless')).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['banana', 'FULL_AI', ''])('ignores an unknown mode %j in the address (one chip stays chosen)', async (mode) => {
    acceptProjects();
    open(`/app/new?topic=x&mode=${mode}`);
    const pressed = [chip('Faceless'), chip('Full AI')].filter((c) => c.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    await userEvent.click(writeScript());
    await waitFor(() => expect(api.calls('POST /projects')).toHaveLength(1));
    expect(['faceless', 'full_ai']).toContain(api.calls('POST /projects')[0].body.mode);
  });

  it.each(['45', 'abc', ''])('ignores an unknown length %j (30 s)', (length) => {
    open(`/app/new?length=${length}`);
    expect(chip('30s')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ideas=1 asks for ideas at once, polls the job (G1), and "Use this" fills the box', async () => {
    api.on('GET /me', () => ({body: {user: user({niche: 'Fitness'})}}));
    api.on('POST /ideas', () => ({status: 202, body: {job: job({id: 'idea-job'})}}));
    let polls = 0;
    api.on('GET /jobs/:id', (_req, {id}) => {
      polls += 1;
      const ideas = [
        {title: 'Leg day myths', hook: 'Stop skipping this', angle: 'Busting myths'},
        {title: 'Protein on a budget', hook: 'Cheap and easy', angle: ''},
      ];
      return {body: {job: polls < 2 ? job({id, state: 'running'}) : job({id, state: 'succeeded', output: {ideas}})}};
    });
    open('/app/new?ideas=1');
    expect(await screen.findByText('Thinking of ideas…')).toBeInTheDocument();
    expect(await screen.findByText('Leg day myths', {}, {timeout: 5000})).toBeInTheDocument();
    expect(screen.getByText('“Stop skipping this”')).toBeInTheDocument();
    expect(api.calls('POST /ideas')).toHaveLength(1);
    expect(api.calls('POST /ideas')[0].body).toMatchObject({niche: 'Fitness', count: 5});
    expect(api.calls('GET /jobs/:id').every((c) => c.path === '/jobs/idea-job')).toBe(true);
    expect(polls).toBeGreaterThanOrEqual(2);
    const card = screen.getByText('Protein on a budget').closest('article')!;
    await userEvent.click(within(card).getByRole('button', {name: /use this/i}));
    expect(box()).toHaveValue('Protein on a budget');
  });

  // src/main.tsx renders the app in <StrictMode>, and AppShell has loaded the user before this
  // screen mounts. Seen on the real backend: the dashboard's Ideas button stays on "Thinking of ideas…".
  it('ideas=1 shows the ideas when the app runs in StrictMode with the user already loaded', async () => {
    const me = user({niche: 'Fitness'});
    api.on('GET /me', () => ({body: {user: me}}));
    api.on('POST /ideas', () => ({status: 202, body: {job: job({id: 'idea-job'})}}));
    api.on('GET /jobs/:id', (_req, {id}) => ({
      body: {job: job({id, state: 'succeeded', output: {ideas: [{title: 'Leg day myths', hook: 'Stop skipping this', angle: ''}]}})},
    }));
    open('/app/new?ideas=1', me, {strict: true});
    await waitFor(() => expect(api.calls('GET /jobs/:id').length).toBeGreaterThan(0));
    expect(await screen.findByText('Leg day myths', {}, {timeout: 4000})).toBeInTheDocument();
    expect(api.calls('POST /ideas')).toHaveLength(1);
  });

  it('Get ideas works in StrictMode too (a click, not an effect)', async () => {
    const me = user({niche: 'Fitness'});
    api.on('POST /ideas', () => ({status: 202, body: {job: job()}}));
    api.on('GET /jobs/:id', () => ({body: {job: job({state: 'succeeded', output: {ideas: [{title: 'Leg day myths', hook: 'h', angle: ''}]}})}}));
    open('/app/new', me, {strict: true});
    await userEvent.click(screen.getByRole('button', {name: /get ideas/i}));
    expect(await screen.findByText('Leg day myths')).toBeInTheDocument();
  });

  it('Get ideas keeps the niche within 120 characters and the keywords within 200 (B1 limits)', async () => {
    api.on('POST /ideas', () => ({status: 202, body: {job: job()}}));
    api.on('GET /jobs/:id', () => ({body: {job: job({state: 'succeeded', output: {ideas: []}})}}));
    open('/app/new', user({niche: 'n'.repeat(150)}));
    fireEvent.change(box(), {target: {value: 'k'.repeat(300)}});
    await userEvent.click(screen.getByRole('button', {name: /get ideas/i}));
    await waitFor(() => expect(api.calls('POST /ideas')).toHaveLength(1));
    const body = api.calls('POST /ideas')[0].body;
    expect(body.niche).toBe('n'.repeat(120));
    expect(body.keywords).toBe('k'.repeat(200));
  });

  it('without a niche, Get ideas uses the topic typed so far', async () => {
    api.on('POST /ideas', () => ({status: 202, body: {job: job()}}));
    api.on('GET /jobs/:id', () => ({body: {job: job({state: 'succeeded', output: {ideas: []}})}}));
    open('/app/new', user({niche: ''}));
    await userEvent.type(box(), 'houseplants');
    await userEvent.click(screen.getByRole('button', {name: /get ideas/i}));
    await waitFor(() => expect(api.calls('POST /ideas')).toHaveLength(1));
    expect(api.calls('POST /ideas')[0].body).toMatchObject({niche: 'houseplants'});
  });

  it('a failed ideas job shows its reason and Try again', async () => {
    api.on('POST /ideas', () => ({status: 202, body: {job: job()}}));
    api.on('GET /jobs/:id', () => ({
      body: {job: job({state: 'failed', error: {code: 'provider_failed', message: 'The AI service didn’t answer.'}})},
    }));
    open();
    await userEvent.click(screen.getByRole('button', {name: /get ideas/i}));
    expect(await screen.findByText(/The AI service didn’t answer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(api.calls('POST /ideas')).toHaveLength(2));
  });
});

describe('New Reel: cost and errors', () => {
  it('shows the script cost and the balance from H1, never a hard-coded cost', async () => {
    api.on('GET /credits', () => ({body: {...credits3(), balance: 42}}));
    open();
    expect(await screen.findByText('3 credits')).toBeInTheDocument();
    expect(screen.getByText(/42 remaining/)).toBeInTheDocument();
  });

  it('402 explains the missing credits with the renewal date, and stays on the page', async () => {
    const resetsAt = '2026-12-01T12:00:00Z';
    api.on('POST /projects', () =>
      apiError(402, 'insufficient_credits', 'Not enough credits.', {needed: 1, balance: 0, resetsAt}),
    );
    open();
    await userEvent.type(box(), 'A topic');
    await userEvent.click(writeScript());
    const day = new Date(resetsAt).toLocaleDateString(undefined, {day: 'numeric', month: 'long'});
    expect(await screen.findByText(`This needs 1 credit and you have 0. Your credits renew on ${day}.`)).toBeInTheDocument();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it.each([
    [409, 'already_running', 'Something is already running.'],
    [503, 'provider_unavailable', 'The AI service is not available right now.'],
  ])('%i shows the API message next to the button', async (status, code, message) => {
    api.on('POST /projects', () => apiError(status, code, message));
    open();
    await userEvent.type(box(), 'A topic');
    await userEvent.click(writeScript());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('a topic field error shows under the box', async () => {
    api.on('POST /projects', () =>
      apiError(400, 'validation_error', 'Some details need another look.', {fields: {topic: 'Use 300 characters or fewer'}}),
    );
    open();
    await userEvent.type(box(), 'A topic');
    await userEvent.click(writeScript());
    expect(await screen.findByText('Use 300 characters or fewer')).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
  });

  // The real API answers e.g. {"voiceId": "That voice isn't available"} (seen on the F5 test stack).
  it.each([
    ['voiceId', 'Narrator'],
    ['mode', 'Visual style'],
    ['targetSeconds', 'Target length'],
    ['tone', 'Tone'],
  ])('a field error on %s is shown with the field’s name', async (field, label) => {
    api.on('POST /projects', () =>
      apiError(400, 'validation_error', 'Some details need another look.', {fields: {[field]: 'That isn’t available'}}),
    );
    open();
    await userEvent.type(box(), 'A topic');
    await userEvent.click(writeScript());
    await waitFor(() => expect(api.calls('POST /projects')).toHaveLength(1));
    expect(await screen.findByText(`${label}: That isn’t available`)).toBeInTheDocument();
  });

  it('several field errors are all listed', async () => {
    api.on('POST /projects', () =>
      apiError(400, 'validation_error', 'Some details need another look.', {
        fields: {mode: 'That value isn’t allowed', voiceId: 'That voice isn’t available'},
      }),
    );
    open();
    await userEvent.type(box(), 'A topic');
    await userEvent.click(writeScript());
    expect(await screen.findByText('Visual style: That value isn’t allowed')).toBeInTheDocument();
    expect(screen.getByText('Narrator: That voice isn’t available')).toBeInTheDocument();
  });
});

/** H1 with a script cost other than 1, to prove the screen reads it. */
function credits3() {
  return {
    balance: 42,
    monthlyAllowance: 100,
    resetsAt: '2026-12-01T00:00:00Z',
    costs: {script: 3, voicePer30s: 2, voiceSceneShort: 1, aiImage: 1, aiVideoClip: 10, render: 2, ideas: 0, hooks: 0, rewrite: 1},
  };
}

// ---------------------------------------------------------------- round 3 (FIX_LOG_F5, Round 3)

describe('New Reel: waiting for ideas and leaving (round 3)', () => {
  afterEach(() => vi.useRealTimers());

  it('ideas asked for with Get ideas stop being polled when the page is left', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    api.on('POST /ideas', () => ({status: 202, body: {job: job({id: 'ij'})}}));
    api.on('GET /jobs/:id', (_req, {id}) => ({body: {job: job({id, state: 'running'})}}));
    const view = openView('/app/new', user({niche: 'Fitness'}));
    fireEvent.click(screen.getByRole('button', {name: /get ideas/i}));
    await waitFor(() => expect(api.calls('GET /jobs/:id')).toHaveLength(1));
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.calls('GET /jobs/:id')).toHaveLength(1);
  });

  // Intended (FIX_LOG_F5 Round 3, QF5-011): the automatic request from the dashboard is not tied
  // to leaving, because React's double mount in development would stop it at once.
  it('the automatic ideas=1 request keeps going after the page is left, until the job ends', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    let polls = 0;
    api.on('POST /ideas', () => ({status: 202, body: {job: job({id: 'ij'})}}));
    api.on('GET /jobs/:id', (_req, {id}) => {
      polls += 1;
      return {body: {job: polls < 3 ? job({id, state: 'running'}) : job({id, state: 'succeeded', output: {ideas: []}})}};
    });
    const view = openView('/app/new?ideas=1', user({niche: 'Fitness'}));
    await waitFor(() => expect(polls).toBe(1));
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(polls).toBe(3);
  });
});
