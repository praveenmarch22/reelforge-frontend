import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AdminJob, AdminTrack, AdminUser, AdminUserDetail, Provider, UsageRow} from '@/api/admin';
import {apiError, installFakeApi, job, user, withBasics, type FakeApi, type FakeRequest} from '@/test/fakeApi';
import {openAt, visited} from '@/test/f7';
import {AdminPage} from './AdminPage';

// Screen 16 (docs/SCREENS_F8.md section 3; API I1-I14). The backend is the fake `fetch` from
// src/test/fakeApi.ts.

let api: FakeApi;
const ME = user({isAdmin: true});

function aUser(n: number, over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: `u${n}`,
    email: `person${n}@example.com`,
    name: `Person ${n}`,
    isAdmin: false,
    isTester: false,
    disabled: false,
    emailVerified: true,
    balance: 80,
    monthlyAllowance: 100,
    projectCount: 2,
    lastLoginAt: '2026-11-26T10:00:00Z',
    createdAt: '2026-11-01T10:00:00Z',
    ...over,
  };
}
const detailOf = (u: AdminUser, over: Partial<AdminUserDetail> = {}): AdminUserDetail => ({
  ...u,
  niche: 'Fitness',
  resetsAt: '2026-12-01T00:00:00Z',
  youtube: null,
  recentJobs: [],
  ...over,
});
const aJob = (id: string, over: Partial<AdminJob> = {}): AdminJob => ({
  ...job({id, type: 'voice', state: 'failed', projectId: 'p1', sceneId: 's1'}),
  userEmail: 'person1@example.com',
  attempts: 1,
  ...over,
});
const aTrack = (n: number, over: Partial<AdminTrack> = {}): AdminTrack => ({
  id: `t${n}`,
  title: `Track ${n}`,
  durationSeconds: 61.4,
  moods: ['calm', 'sad'],
  license: 'CC BY 4.0',
  sourceUrl: '',
  previewUrl: `/media/t${n}.mp3`,
  isActive: true,
  createdAt: '2026-11-01T10:00:00Z',
  ...over,
});
const PROVIDERS: Provider[] = [
  {name: 'gemini', purpose: 'language model', enabled: true, reason: '', callsToday: 40, errorRateToday: 0.25},
  {name: 'elevenlabs', purpose: 'voice', enabled: false, reason: 'Quota used up', callsToday: 0, errorRateToday: null},
];

function setup(me = ME) {
  api = installFakeApi();
  withBasics(api, {me});
}
const open = (path = '/admin') => openAt(path, [{path: '/admin', element: <AdminPage />}]);
const query = (req: FakeRequest) => new URLSearchParams(req.path.split('?')[1] ?? '');
const last = <T,>(items: T[]): T => items[items.length - 1];
const adminCalls = () => api.requests.filter((r) => r.path.startsWith('/admin'));

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('admin: access and tabs', () => {
  it('someone who is not an admin is sent to the app, and nothing is asked of the admin API', async () => {
    setup(user({isAdmin: false}));
    open();

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/app$/);
    expect(screen.queryByRole('heading', {name: 'Admin'})).not.toBeInTheDocument();
    expect(adminCalls()).toHaveLength(0);
  });

  it('an admin sees the six tabs, with Overview first', async () => {
    setup();
    api.on('GET /admin/stats', () => ({body: {users: 12, projects: 34, failedJobsToday: 5, creditsInCirculation: 6789}}));
    open();

    expect(await screen.findByRole('heading', {name: 'Admin'})).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Users', 'Jobs', 'Providers', 'Usage', 'Music']);
    expect(screen.getByRole('tab', {selected: true})).toHaveTextContent('Overview');
  });

  it('Overview shows users, Reels, today’s failed jobs and credits held', async () => {
    setup();
    api.on('GET /admin/stats', () => ({body: {users: 12, projects: 34, failedJobsToday: 5, creditsInCirculation: 6789}}));
    open();

    const value = async (label: string) => (await within(screen.getByRole('tabpanel')).findByText(label)).nextElementSibling?.textContent;
    await waitFor(async () => expect(await value('Users')).toBe('12'));
    expect(await value('Reels')).toBe('34');
    expect(await value('Failed jobs today')).toBe('5');
    expect(await value('Credits held by users')).toBe('6789');
  });

  it('Overview says so when the numbers can’t be loaded', async () => {
    setup();
    api.on('GET /admin/stats', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    open();

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
  });

  it('choosing a tab puts it in the address, and ?tab= opens one directly', async () => {
    setup();
    api.on('GET /admin/providers', () => ({body: {items: PROVIDERS}}));
    api.on('GET /admin/usage', () => ({body: {items: []}}));
    open('/admin?tab=providers');

    expect(await screen.findByText(/gemini/)).toBeInTheDocument();
    expect(screen.getByRole('tab', {selected: true})).toHaveTextContent('Providers');

    await userEvent.click(screen.getByRole('tab', {name: 'Usage'}));
    expect(last(visited)).toBe('/admin?tab=usage');
    expect(await screen.findByText('No usage in this period.')).toBeInTheDocument();
  });

  it('the arrow keys move between tabs and choose them', async () => {
    setup();
    api.on('GET /admin/stats', () => ({body: {users: 1, projects: 0, failedJobsToday: 0, creditsInCirculation: 100}}));
    api.on('GET /admin/users', () => ({body: {items: [], nextCursor: null}}));
    api.on('GET /admin/music', () => ({body: {items: []}}));
    open();

    (await screen.findByRole('tab', {name: 'Overview'})).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', {selected: true})).toHaveTextContent('Users');
    expect(screen.getByRole('tab', {name: 'Users'})).toHaveFocus();
    expect(last(visited)).toBe('/admin?tab=users');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', {selected: true})).toHaveTextContent('Music');
  });

  it('an unknown tab falls back to Overview', async () => {
    setup();
    api.on('GET /admin/stats', () => ({body: {users: 1, projects: 0, failedJobsToday: 0, creditsInCirculation: 100}}));
    open('/admin?tab=billing');

    await screen.findByRole('heading', {name: 'Admin'});
    expect(screen.getByRole('tab', {selected: true})).toHaveTextContent('Overview');
  });
});

describe('admin: users', () => {
  let people: AdminUser[];
  let details: Record<string, AdminUserDetail>;
  const lists = () => api.calls('GET /admin/users');
  const updates = () => api.calls('PATCH /admin/users/:id');
  const adjustments = () => api.calls('POST /admin/users/:id/credits');

  function setupUsers(list: AdminUser[] = [aUser(1), aUser(2, {email: 'zed@example.com', name: 'Zed Person'})]) {
    setup();
    people = list;
    details = Object.fromEntries(people.map((u) => [u.id, detailOf(u)]));
    api.on('GET /admin/users', (req) => {
      const q = (query(req).get('q') ?? '').toLowerCase();
      return {body: {items: people.filter((u) => (u.email + u.name).toLowerCase().includes(q)), nextCursor: null}};
    });
    api.on('GET /admin/users/:id', (_req, {id}) => (details[id] ? {body: {user: details[id]}} : apiError(404, 'not_found', 'We couldn’t find that.')));
    api.on('PATCH /admin/users/:id', (req, {id}) => {
      details[id] = {...details[id], ...req.body};
      people = people.map((u) => (u.id === id ? {...u, ...req.body} : u));
      return {body: {user: details[id]}};
    });
    api.on('POST /admin/users/:id/credits', (req, {id}) => {
      details[id] = {...details[id], balance: details[id].balance + req.body.amount};
      return {status: 201, body: {balance: details[id].balance}};
    });
  }
  const openUsers = async () => {
    open('/admin?tab=users');
    await screen.findByRole('textbox', {name: 'Search by email or name'});
  };
  const openPanel = async (email: string) => {
    await openUsers();
    await userEvent.click(await screen.findByRole('button', {name: new RegExp(email)}));
    return screen.findByRole('complementary', {name: `Details of ${email}`});
  };

  it('lists a row per user with credits, Reels and badges', async () => {
    setupUsers([
      aUser(1, {isAdmin: true, isTester: true, balance: 480, monthlyAllowance: 500, projectCount: 7}),
      aUser(2, {disabled: true, emailVerified: false, lastLoginAt: null}),
    ]);
    await openUsers();

    const first = (await screen.findByText('person1@example.com')).closest('tr')!;
    expect(first).toHaveTextContent('Person 1');
    expect(first).toHaveTextContent('480 / 500');
    expect(within(first).getAllByRole('cell')[2]).toHaveTextContent('7');
    expect(first).toHaveTextContent('Admin');
    expect(first).toHaveTextContent('Tester');
    expect(first).not.toHaveTextContent('Disabled');
    const second = screen.getByText('person2@example.com').closest('tr')!;
    expect(second).toHaveTextContent('Disabled');
    expect(second).toHaveTextContent('Not verified');
    expect(second).toHaveTextContent('never');
    expect(second).not.toHaveTextContent('Admin');
    expect(lists()[0].path).toMatch(/^\/admin\/users\?limit=20$/);
    expect(screen.getByText('Choose a user to see more.')).toBeInTheDocument();
  });

  it('searches once the typing has paused, not on every keystroke', async () => {
    setupUsers();
    await openUsers();
    await screen.findByText('person1@example.com');
    const before = lists().length;

    const box = screen.getByRole('textbox', {name: 'Search by email or name'});
    fireEvent.change(box, {target: {value: 'z'}});
    fireEvent.change(box, {target: {value: 'ze'}});
    fireEvent.change(box, {target: {value: ' zed '}});
    expect(lists()).toHaveLength(before); // nothing yet

    await waitFor(() => expect(lists().length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText('person1@example.com')).not.toBeInTheDocument());
    expect(screen.getByText('zed@example.com')).toBeInTheDocument();
    const searches = lists().slice(before).map((r) => query(r).get('q'));
    expect(searches).toEqual(['zed']);
  });

  it('says when nobody matches, and when the list can’t be loaded', async () => {
    setupUsers();
    await openUsers();
    fireEvent.change(screen.getByRole('textbox', {name: 'Search by email or name'}), {target: {value: 'nobody'}});
    expect(await screen.findByText('No users match.')).toBeInTheDocument();

    api.on('GET /admin/users', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    fireEvent.change(screen.getByRole('textbox', {name: 'Search by email or name'}), {target: {value: 'other'}});
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
  });

  it('Load more asks for the next page with the cursor', async () => {
    setupUsers();
    api.on('GET /admin/users', (req) =>
      query(req).get('cursor')
        ? {body: {items: [aUser(3)], nextCursor: null}}
        : {body: {items: [aUser(1), aUser(2)], nextCursor: 'page 2'}},
    );
    await openUsers();

    await userEvent.click(await screen.findByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('person3@example.com')).toBeInTheDocument();
    expect(screen.getByText('person1@example.com')).toBeInTheDocument();
    expect(query(last(lists())).get('cursor')).toBe('page 2');
    await waitFor(() => expect(screen.queryByRole('button', {name: 'Load more'})).not.toBeInTheDocument());
  });

  it('opening a user shows their details, YouTube connection and recent jobs', async () => {
    setupUsers();
    details.u1 = detailOf(aUser(1), {
      youtube: {status: 'connected', name: 'Person One TV'},
      recentJobs: [job({id: 'a', type: 'voice', state: 'failed'}), job({id: 'b', type: 'script', state: 'succeeded'})],
    });
    const panel = await openPanel('person1@example.com');

    expect(panel).toHaveTextContent('Person 1');
    expect(panel).toHaveTextContent('YouTube: Person One TV (connected)');
    expect(panel).toHaveTextContent('Monthly allowance (now 100)');
    expect(panel).toHaveTextContent('Adjust credits (balance 80)');
    const jobs = within(panel).getAllByRole('listitem').map((li) => li.textContent);
    expect(jobs).toEqual(['voicefailed', 'scriptsucceeded']);
  });

  it('a user with no connection and no jobs says so', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    expect(panel).toHaveTextContent('YouTube: not connected');
    expect(panel).toHaveTextContent('None yet.');
  });

  it('the Tester toggle saves at once and the row gets its badge', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    await userEvent.click(within(panel).getByRole('checkbox', {name: /^Tester/}));

    await waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].path).toBe('/admin/users/u1');
    expect(updates()[0].body).toEqual({isTester: true});
    await waitFor(() => expect(within(panel).getByRole('checkbox', {name: /^Tester/})).toBeChecked());
    await waitFor(() => expect(screen.getByRole('button', {name: /person1@example.com/}).closest('tr')).toHaveTextContent('Tester'));
  });

  it.each([
    ['Admin', /^Admin$/, {isAdmin: true}],
    ['Disabled', /^Disabled/, {disabled: true}],
  ] as const)('the %s toggle asks to confirm, naming the user, then saves', async (_label, name, body) => {
    setupUsers();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = await openPanel('person1@example.com');

    await userEvent.click(within(panel).getByRole('checkbox', {name}));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('person1@example.com');
    await waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].body).toEqual(body);
    await waitFor(() => expect(within(panel).getByRole('checkbox', {name})).toBeChecked());
  });

  it.each([
    ['Admin', /^Admin$/],
    ['Disabled', /^Disabled/],
  ] as const)('the %s toggle not confirmed: nothing is sent and the box stays as it was', async (_label, name) => {
    setupUsers();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const panel = await openPanel('person1@example.com');

    await userEvent.click(within(panel).getByRole('checkbox', {name}));

    expect(updates()).toHaveLength(0);
    expect(within(panel).getByRole('checkbox', {name})).not.toBeChecked();
  });

  it('removing a role asks with "Remove"', async () => {
    setupUsers([aUser(1, {isAdmin: true})]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = await openPanel('person1@example.com');

    await userEvent.click(within(panel).getByRole('checkbox', {name: /^Admin$/}));

    expect(confirm.mock.calls[0][0]).toMatch(/^Remove/);
    await waitFor(() => expect(updates()[0]?.body).toEqual({isAdmin: false}));
  });

  it('on their own account an admin cannot untick Admin or tick Disabled', async () => {
    setupUsers([aUser(1, {id: ME.id, email: ME.email, isAdmin: true}), aUser(2)]);
    const panel = await openPanel(ME.email);

    expect(within(panel).getByRole('checkbox', {name: /^Admin$/})).toBeDisabled();
    expect(within(panel).getByRole('checkbox', {name: /^Disabled/})).toBeDisabled();
    expect(within(panel).getByRole('checkbox', {name: /^Tester/})).toBeEnabled();
  });

  it('shows the server’s refusal when a change wasn’t saved', async () => {
    setupUsers();
    api.on('PATCH /admin/users/:id', () => apiError(409, 'own_account', 'You can’t disable your own account or remove your own admin role.'));
    const panel = await openPanel('person1@example.com');

    await userEvent.click(within(panel).getByRole('checkbox', {name: /^Disabled/}));

    expect(await within(panel).findByText('You can’t disable your own account or remove your own admin role.')).toBeInTheDocument();
    expect(within(panel).getByRole('checkbox', {name: /^Disabled/})).not.toBeChecked();
  });

  it('sets the monthly allowance, then shows the new one and empties the box', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    const box = within(panel).getByRole('textbox', {name: /^Monthly allowance/});
    expect(within(panel).getByRole('button', {name: 'Set'})).toBeDisabled();
    await userEvent.type(box, '500');
    await userEvent.click(within(panel).getByRole('button', {name: 'Set'}));

    await waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].body).toEqual({monthlyAllowance: 500});
    expect(await within(panel).findByText('Monthly allowance (now 500)')).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', {name: /^Monthly allowance/})).toHaveValue('');
  });

  it('an allowance of 0 is allowed', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    await userEvent.type(within(panel).getByRole('textbox', {name: /^Monthly allowance/}), '0');
    await userEvent.click(within(panel).getByRole('button', {name: 'Set'}));

    await waitFor(() => expect(updates()[0]?.body).toEqual({monthlyAllowance: 0}));
  });

  it.each(['abc', '-5', '10.5'])('an allowance of "%s" is not sent', async (typed) => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    const box = within(panel).getByRole('textbox', {name: /^Monthly allowance/});
    await userEvent.type(box, typed);
    fireEvent.submit(box.closest('form')!);

    expect(updates()).toHaveLength(0);
  });

  it('adjusts credits with an amount and a note, then shows the new balance and empties the form', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    await userEvent.type(within(panel).getByRole('textbox', {name: /^Amount/}), '-25');
    await userEvent.type(within(panel).getByRole('textbox', {name: /^Note/}), '  Refund for a bad render  ');
    await userEvent.click(within(panel).getByRole('button', {name: 'Adjust'}));

    await waitFor(() => expect(adjustments()).toHaveLength(1));
    expect(adjustments()[0].path).toBe('/admin/users/u1/credits');
    expect(adjustments()[0].body).toEqual({amount: -25, note: 'Refund for a bad render'});
    expect(await within(panel).findByText('Adjust credits (balance 55)')).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', {name: /^Amount/})).toHaveValue('');
    expect(within(panel).getByRole('textbox', {name: /^Note/})).toHaveValue('');
  });

  it('a typographic minus sign (−) takes credits away like a hyphen', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    fireEvent.change(within(panel).getByRole('textbox', {name: /^Amount/}), {target: {value: '−10'}});
    await userEvent.type(within(panel).getByRole('textbox', {name: /^Note/}), 'Correction');
    await userEvent.click(within(panel).getByRole('button', {name: 'Adjust'}));

    await waitFor(() => expect(adjustments()).toHaveLength(1));
    expect(adjustments()[0].body).toEqual({amount: -10, note: 'Correction'});
  });

  it.each([
    ['no amount', '', 'A note'],
    ['an amount of 0', '0', 'A note'],
    ['a fraction', '2.5', 'A note'],
    ['words', 'ten', 'A note'],
    ['no note', '25', ''],
    ['a note of spaces', '25', '   '],
  ])('Adjust stays off with %s, and nothing is sent', async (_what, amount, note) => {
    setupUsers();
    const panel = await openPanel('person1@example.com');

    const amountBox = within(panel).getByRole('textbox', {name: /^Amount/});
    if (amount) await userEvent.type(amountBox, amount);
    if (note) await userEvent.type(within(panel).getByRole('textbox', {name: /^Note/}), note);

    expect(within(panel).getByRole('button', {name: 'Adjust'})).toBeDisabled();
    fireEvent.submit(amountBox.closest('form')!);
    expect(adjustments()).toHaveLength(0);
  });

  it('shows the server’s refusal when the balance would go below zero, and keeps what was typed', async () => {
    setupUsers();
    api.on('POST /admin/users/:id/credits', () => apiError(409, 'balance_negative', 'That would take the balance below zero (it is 80).'));
    const panel = await openPanel('person1@example.com');

    await userEvent.type(within(panel).getByRole('textbox', {name: /^Amount/}), '-500');
    await userEvent.type(within(panel).getByRole('textbox', {name: /^Note/}), 'Too much');
    await userEvent.click(within(panel).getByRole('button', {name: 'Adjust'}));

    expect(await within(panel).findByText('That would take the balance below zero (it is 80).')).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', {name: /^Amount/})).toHaveValue('-500');
    expect(panel).toHaveTextContent('Adjust credits (balance 80)');
  });

  it('opening another user starts with an empty form', async () => {
    setupUsers();
    const panel = await openPanel('person1@example.com');
    await userEvent.type(within(panel).getByRole('textbox', {name: /^Note/}), 'Half-typed');

    await userEvent.click(screen.getByRole('button', {name: /zed@example.com/}));

    const other = await screen.findByRole('complementary', {name: 'Details of zed@example.com'});
    expect(within(other).getByRole('textbox', {name: /^Note/})).toHaveValue('');
  });
});

describe('admin: jobs', () => {
  let rows: AdminJob[];
  const lists = () => api.calls('GET /admin/jobs');
  const retries = () => api.calls('POST /admin/jobs/:id/retry');
  const filters = () => Object.fromEntries(query(last(lists())));
  const row = (id: string) => screen.getByText(id).closest('tr')!;

  function setupJobs() {
    setup();
    rows = [
      aJob('j-voice', {type: 'voice', provider: 'elevenlabs', userEmail: 'voice@example.com', error: {code: 'provider_failed', message: 'The voice service did not answer.'}}),
      aJob('j-visual', {type: 'visual', userEmail: 'visual@example.com'}),
      aJob('j-render', {type: 'render', userEmail: 'render@example.com'}),
      aJob('j-script', {type: 'script', userEmail: 'script@example.com'}),
      aJob('j-ideas', {type: 'ideas', userEmail: 'ideas@example.com'}),
      aJob('j-done', {type: 'voice', state: 'succeeded', userEmail: 'done@example.com'}),
      aJob('j-queued', {type: 'visual', state: 'queued', userEmail: 'queued@example.com'}),
    ];
    api.on('GET /admin/jobs', () => ({body: {items: rows, nextCursor: null}}));
    api.on('POST /admin/jobs/:id/retry', () => ({status: 202, body: {job: job({id: 'j-new', type: 'voice'})}}));
  }
  const openJobs = async () => {
    open('/admin?tab=jobs');
    await screen.findByText('voice@example.com');
  };
  const rowOf = (email: string) => screen.getByText(email).closest('tr')!;
  void row;

  it('starts on failed jobs, and each filter narrows the request', async () => {
    setupJobs();
    await openJobs();

    expect(filters()).toEqual({state: 'failed', limit: '25'});
    expect(screen.getByRole('combobox', {name: 'State'})).toHaveValue('failed');

    await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Type'}), 'voice');
    await waitFor(() => expect(filters()).toEqual({state: 'failed', type: 'voice', limit: '25'}));

    await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Provider'}), 'elevenlabs');
    await waitFor(() => expect(filters()).toEqual({state: 'failed', type: 'voice', provider: 'elevenlabs', limit: '25'}));

    await userEvent.selectOptions(screen.getByRole('combobox', {name: 'State'}), 'Any');
    await waitFor(() => expect(filters()).toEqual({type: 'voice', provider: 'elevenlabs', limit: '25'}));
  });

  it('offers every job state, and the kinds of work and providers an admin looks for', async () => {
    setupJobs();
    await openJobs();

    const options = (name: string) => within(screen.getByRole('combobox', {name})).getAllByRole('option').map((o) => o.textContent);
    expect(options('State')).toEqual(['Any', 'failed', 'queued', 'running', 'succeeded', 'cancelled']);
    expect(options('Type')).toEqual(expect.arrayContaining(['Any', 'script', 'voice', 'visual', 'render', 'publish']));
    expect(options('Provider')).toEqual(expect.arrayContaining(['Any', 'gemini', 'groq', 'elevenlabs', 'edge', 'pixabay', 'cloudflare', 'youtube']));
  });

  it('a row shows the kind, provider, owner, state and the error', async () => {
    setupJobs();
    await openJobs();

    const voice = rowOf('voice@example.com');
    expect(voice).toHaveTextContent('voice');
    expect(voice).toHaveTextContent('elevenlabs');
    expect(voice).toHaveTextContent('failed');
    expect(voice).toHaveTextContent('provider_failed: The voice service did not answer.');
    expect(rowOf('done@example.com')).toHaveTextContent('succeeded');
  });

  it('offers Retry only for failed voice and visual jobs', async () => {
    setupJobs();
    await openJobs();

    const canRetry = (email: string) => within(rowOf(email)).queryByRole('button', {name: 'Retry'}) !== null;
    expect(canRetry('voice@example.com')).toBe(true);
    expect(canRetry('visual@example.com')).toBe(true);
    expect(canRetry('render@example.com')).toBe(false);
    expect(canRetry('script@example.com')).toBe(false);
    expect(canRetry('ideas@example.com')).toBe(false); // the API refuses these since QB8-005
    expect(canRetry('done@example.com')).toBe(false);
    expect(canRetry('queued@example.com')).toBe(false);
  });

  it('Retry starts that job again, says it was retried, and cannot be pressed twice', async () => {
    setupJobs();
    await openJobs();

    await userEvent.click(within(rowOf('voice@example.com')).getByRole('button', {name: 'Retry'}));

    await waitFor(() => expect(retries()).toHaveLength(1));
    expect(retries()[0].path).toBe('/admin/jobs/j-voice/retry');
    expect(await within(rowOf('voice@example.com')).findByText('Retried')).toBeInTheDocument();
    expect(within(rowOf('voice@example.com')).queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
    expect(within(rowOf('visual@example.com')).getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    await waitFor(() => expect(lists().length).toBeGreaterThan(1)); // the list is read again
  });

  it('a job the API says was already retried shows "Retried" instead of the button', async () => {
    setupJobs();
    rows[0] = {...rows[0], output: {retriedAs: 'j-newer'}};
    await openJobs();

    expect(within(rowOf('voice@example.com')).getByText('Retried')).toBeInTheDocument();
    expect(within(rowOf('voice@example.com')).queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
  });

  it('shows why when the retry is refused, and the button is still there', async () => {
    setupJobs();
    api.on('POST /admin/jobs/:id/retry', () => apiError(409, 'not_retryable', 'The scene is no longer failed.'));
    await openJobs();

    await userEvent.click(within(rowOf('visual@example.com')).getByRole('button', {name: 'Retry'}));

    expect(await screen.findByText('The scene is no longer failed.')).toBeInTheDocument();
    expect(within(rowOf('visual@example.com')).queryByText('Retried')).not.toBeInTheDocument();
  });

  it('says when no jobs match, and Load more pages with the cursor', async () => {
    setup();
    api.on('GET /admin/jobs', (req) => {
      if (query(req).get('type') === 'publish') return {body: {items: [], nextCursor: null}};
      return query(req).get('cursor')
        ? {body: {items: [aJob('j2', {userEmail: 'second@example.com'})], nextCursor: null}}
        : {body: {items: [aJob('j1', {userEmail: 'first@example.com'})], nextCursor: 'next'}};
    });
    open('/admin?tab=jobs');

    await userEvent.click(await screen.findByRole('button', {name: 'Load more'}));
    expect(await screen.findByText('second@example.com')).toBeInTheDocument();
    expect(screen.getByText('first@example.com')).toBeInTheDocument();
    expect(query(last(lists())).get('cursor')).toBe('next');

    await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Type'}), 'publish');
    expect(await screen.findByText('No jobs match.')).toBeInTheDocument();
  });
});

describe('admin: providers', () => {
  let items: Provider[];
  const switches = () => api.calls('PATCH /admin/providers/:name');
  const rowOf = (name: string) => screen.getByText(new RegExp(`^${name}`)).closest('li')!;

  function setupProviders() {
    setup();
    items = PROVIDERS.map((p) => ({...p}));
    api.on('GET /admin/providers', () => ({body: {items}}));
    api.on('PATCH /admin/providers/:name', (req, {name}) => {
      items = items.map((p) => (p.name === name ? {...p, ...req.body} : p));
      return {body: {provider: items.find((p) => p.name === name)}};
    });
  }
  const openProviders = async () => {
    open('/admin?tab=providers');
    await screen.findByText(/^gemini/);
  };

  it('lists each provider with what it is for, its switch, today’s calls and error rate, and why it is off', async () => {
    setupProviders();
    await openProviders();

    const gemini = rowOf('gemini');
    expect(gemini).toHaveTextContent('language model');
    expect(gemini).toHaveTextContent('40 calls today');
    expect(gemini).toHaveTextContent('25% failed');
    expect(gemini).toHaveTextContent('On');
    expect(within(gemini).getByRole('button', {name: 'Switch off'})).toBeInTheDocument();
    const eleven = rowOf('elevenlabs');
    expect(eleven).toHaveTextContent('0 calls today');
    expect(eleven).not.toHaveTextContent('% failed');
    expect(eleven).toHaveTextContent('off: Quota used up');
    expect(within(eleven).getByRole('button', {name: 'Switch on'})).toBeInTheDocument();
  });

  it('switching off asks for the reason and sends it', async () => {
    setupProviders();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  Free quota used up  ');
    await openProviders();

    await userEvent.click(within(rowOf('gemini')).getByRole('button', {name: 'Switch off'}));

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0]).toContain('gemini');
    await waitFor(() => expect(switches()).toHaveLength(1));
    expect(switches()[0].path).toBe('/admin/providers/gemini');
    expect(switches()[0].body).toEqual({enabled: false, reason: 'Free quota used up'});
    await waitFor(() => expect(rowOf('gemini')).toHaveTextContent('off: Free quota used up'));
    expect(within(rowOf('gemini')).getByRole('button', {name: 'Switch on'})).toBeInTheDocument();
  });

  it.each([
    ['cancelled', null],
    ['left empty', ''],
    ['only spaces', '   '],
  ])('with the reason %s, nothing is switched', async (_what, answer) => {
    setupProviders();
    vi.spyOn(window, 'prompt').mockReturnValue(answer);
    await openProviders();

    await userEvent.click(within(rowOf('gemini')).getByRole('button', {name: 'Switch off'}));

    expect(switches()).toHaveLength(0);
    expect(within(rowOf('gemini')).getByRole('button', {name: 'Switch off'})).toBeInTheDocument();
  });

  it('switching on needs no reason', async () => {
    setupProviders();
    const prompt = vi.spyOn(window, 'prompt');
    await openProviders();

    await userEvent.click(within(rowOf('elevenlabs')).getByRole('button', {name: 'Switch on'}));

    await waitFor(() => expect(switches()).toHaveLength(1));
    expect(prompt).not.toHaveBeenCalled();
    expect(switches()[0].path).toBe('/admin/providers/elevenlabs');
    expect(switches()[0].body).toMatchObject({enabled: true});
    await waitFor(() => expect(within(rowOf('elevenlabs')).getByRole('button', {name: 'Switch off'})).toBeInTheDocument());
  });

  it('shows the reason when the switch wasn’t saved', async () => {
    setupProviders();
    api.on('PATCH /admin/providers/:name', () => apiError(400, 'validation_error', 'Some details need another look.', {fields: {reason: 'Say why it is off'}}));
    vi.spyOn(window, 'prompt').mockReturnValue('x');
    await openProviders();

    await userEvent.click(within(rowOf('gemini')).getByRole('button', {name: 'Switch off'}));

    expect(await screen.findByText('Say why it is off')).toBeInTheDocument();
  });
});

describe('admin: usage', () => {
  const usageRow = (over: Partial<UsageRow>): UsageRow => ({
    day: '2026-11-27', provider: 'gemini', jobType: 'script', calls: 12, failures: 0, creditsCharged: 12, costEstimateUsd: 0, ...over,
  });

  it('lists calls, failures and credits per day, provider and kind of job', async () => {
    setup();
    api.on('GET /admin/usage', () => ({
      body: {
        items: [usageRow({}), usageRow({day: '2026-11-26', provider: 'elevenlabs', jobType: 'voice', calls: 30, failures: 4, creditsCharged: 55})],
        from: '2026-10-29',
        to: '2026-11-27',
      },
    }));
    open('/admin?tab=usage');

    await screen.findByText('2026-11-26');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Day', 'Provider', 'Job', 'Calls', 'Failed', 'Credits']);
    const cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(cells).toEqual([
      ['2026-11-27', 'gemini', 'script', '12', '0', '12'],
      ['2026-11-26', 'elevenlabs', 'voice', '30', '4', '55'],
    ]);
    expect(api.calls('GET /admin/usage')[0].path).toBe('/admin/usage'); // the API's default: the last 30 days
  });

  it('says when there was no usage, and when it can’t be loaded', async () => {
    setup();
    api.on('GET /admin/usage', () => ({body: {items: []}}));
    const view = open('/admin?tab=usage');
    expect(await screen.findByText('No usage in this period.')).toBeInTheDocument();
    view.unmount();

    api.on('GET /admin/usage', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    open('/admin?tab=usage');
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
  });
});

describe('admin: music', () => {
  let tracks: AdminTrack[];
  const UPLOAD = 'https://storage.example/upload/t9?sig=abc';
  const adds = () => api.calls('POST /admin/music');
  const patches = () => api.calls('PATCH /admin/music/:id');
  const deletes = () => api.calls('DELETE /admin/music/:id');
  const uploads = () => api.requests.filter((r) => r.method === 'PUT');
  const rowOf = (title: string) => screen.getByText(title).closest('li')!;
  const mp3 = (name = 'night.mp3', type = 'audio/mpeg', size = 2048) => new File([new Uint8Array(size)], name, {type});

  /** Stands in for the browser reading an audio file's length. */
  function stubAudio(duration: number | 'error') {
    class FakeAudio {
      duration = duration === 'error' ? NaN : duration;
      onloadedmetadata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        queueMicrotask(() => (duration === 'error' ? this.onerror?.() : this.onloadedmetadata?.()));
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  }

  function setupMusic() {
    setup();
    tracks = [aTrack(1), aTrack(2, {isActive: false, moods: ['tense'], license: 'CC0'})];
    api.on('GET /admin/music', () => ({body: {items: tracks}}));
    api.on('PATCH /admin/music/:id', (req, {id}) => {
      tracks = tracks.map((t) => (t.id === id ? {...t, ...req.body} : t));
      return {body: {track: tracks.find((t) => t.id === id)}};
    });
    api.on('DELETE /admin/music/:id', (_req, {id}) => {
      tracks = tracks.filter((t) => t.id !== id);
      return {body: {deleted: true, track: null}};
    });
    api.on('POST /admin/music', (req) => {
      const track = aTrack(9, {title: req.body.title, moods: req.body.moods, license: req.body.license, isActive: false});
      tracks = [...tracks, track];
      return {status: 201, body: {track, uploadUrl: UPLOAD}};
    });
    api.on(`PUT ${UPLOAD.split('?')[0]}`, () => ({status: 200}));
  }
  const openMusic = async () => {
    open('/admin?tab=music');
    await screen.findByText('Track 1');
  };
  async function fillForm({file = mp3() as File | null, title = 'Night Drive', licence = 'CC BY 4.0: Someone', moods = ['calm', 'sad']} = {}) {
    if (title) await userEvent.type(screen.getByRole('textbox', {name: 'Title'}), title);
    if (licence) await userEvent.type(screen.getByRole('textbox', {name: 'Licence and credit line'}), licence);
    for (const mood of moods) await userEvent.click(screen.getByRole('button', {name: mood}));
    if (file) await userEvent.upload(screen.getByLabelText(/^Audio file/), file);
  }
  const addTrack = () => userEvent.click(screen.getByRole('button', {name: 'Add track'}));

  it('lists the library, switched-off tracks included, with moods, length and licence', async () => {
    setupMusic();
    await openMusic();

    expect(rowOf('Track 1')).toHaveTextContent('calm, sad · 61 s · CC BY 4.0');
    expect(rowOf('Track 1')).toHaveTextContent('Active');
    expect(within(rowOf('Track 1')).getByRole('button', {name: 'Switch off'})).toBeInTheDocument();
    expect(rowOf('Track 2')).toHaveTextContent('tense · 61 s · CC0');
    expect(within(rowOf('Track 2')).getByRole('button', {name: 'Switch on'})).toBeInTheDocument();
  });

  it('an empty library says so', async () => {
    setup();
    api.on('GET /admin/music', () => ({body: {items: []}}));
    open('/admin?tab=music');

    expect(await screen.findByText('The library is empty.')).toBeInTheDocument();
  });

  it('switches a track off and on', async () => {
    setupMusic();
    await openMusic();

    await userEvent.click(within(rowOf('Track 1')).getByRole('button', {name: 'Switch off'}));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].path).toBe('/admin/music/t1');
    expect(patches()[0].body).toEqual({isActive: false});
    expect(await within(rowOf('Track 1')).findByRole('button', {name: 'Switch on'})).toBeInTheDocument();

    await userEvent.click(within(rowOf('Track 2')).getByRole('button', {name: 'Switch on'}));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1].body).toEqual({isActive: true});
  });

  it('says why a track without its file can’t be switched on', async () => {
    setupMusic();
    api.on('PATCH /admin/music/:id', () => apiError(409, 'file_missing', 'Upload the track’s file before switching it on.'));
    await openMusic();

    await userEvent.click(within(rowOf('Track 2')).getByRole('button', {name: 'Switch on'}));

    expect(await screen.findByText('Upload the track’s file before switching it on.')).toBeInTheDocument();
    expect(within(rowOf('Track 2')).getByRole('button', {name: 'Switch on'})).toBeInTheDocument();
  });

  it('Delete asks first, saying a track in use is only switched off; confirmed, it goes', async () => {
    setupMusic();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openMusic();

    await userEvent.click(within(rowOf('Track 1')).getByRole('button', {name: 'Delete'}));

    expect(confirm.mock.calls[0][0]).toContain('Track 1');
    expect(confirm.mock.calls[0][0]).toMatch(/switched off instead/);
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].path).toBe('/admin/music/t1');
    await waitFor(() => expect(screen.queryByText('Track 1')).not.toBeInTheDocument());
    expect(screen.getByText('Track 2')).toBeInTheDocument();
  });

  it('Delete not confirmed: nothing is sent', async () => {
    setupMusic();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openMusic();

    await userEvent.click(within(rowOf('Track 1')).getByRole('button', {name: 'Delete'}));

    expect(deletes()).toHaveLength(0);
    expect(screen.getByText('Track 1')).toBeInTheDocument();
  });

  it('a track a Reel uses stays in the list, switched off', async () => {
    setupMusic();
    api.on('DELETE /admin/music/:id', (_req, {id}) => {
      tracks = tracks.map((t) => (t.id === id ? {...t, isActive: false} : t));
      return {body: {deleted: false, track: tracks.find((t) => t.id === id)}};
    });
    await openMusic();

    await userEvent.click(within(rowOf('Track 1')).getByRole('button', {name: 'Delete'}));

    expect(await within(rowOf('Track 1')).findByRole('button', {name: 'Switch on'})).toBeInTheDocument();
  });

  it('Add track saves the details with the file’s name, type, size and length, uploads the file, then switches it on', async () => {
    setupMusic();
    stubAudio(61.23456);
    await openMusic();
    const file = mp3();

    await fillForm({file});
    await userEvent.type(screen.getByRole('textbox', {name: /^Source link/}), ' https://example.com/night ');
    await addTrack();

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(adds()).toHaveLength(1);
    expect(adds()[0].body).toEqual({
      title: 'Night Drive',
      license: 'CC BY 4.0: Someone',
      sourceUrl: 'https://example.com/night',
      moods: ['calm', 'sad'],
      durationSeconds: 61.235,
      filename: 'night.mp3',
      contentType: 'audio/mpeg',
      sizeBytes: 2048,
    });
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0].path).toBe(UPLOAD);
    expect(uploads()[0].headers['Content-Type']).toBe('audio/mpeg');
    expect(uploads()[0].headers).not.toHaveProperty('X-CSRF-Token'); // storage is not the API
    expect(patches()[0].path).toBe('/admin/music/t9');
    expect(patches()[0].body).toEqual({isActive: true});
    const order = api.requests.filter((r) => r.method !== 'GET').map((r) => r.method);
    expect(order).toEqual(['POST', 'PUT', 'PATCH']);

    // The new track is listed and the form is ready for the next one.
    expect(await screen.findByText('Night Drive')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', {name: 'Title'})).toHaveValue(''));
    expect(screen.getByRole('textbox', {name: 'Licence and credit line'})).toHaveValue('');
    expect(screen.getByRole('button', {name: 'calm'})).toHaveAttribute('aria-pressed', 'false');
    expect((screen.getByLabelText(/^Audio file/) as HTMLInputElement).files).toHaveLength(0);
  });

  it.each([
    ['the title', {title: ''}],
    ['the licence', {licence: ''}],
    ['a mood', {moods: []}],
    ['a file', {file: null}],
  ])('without %s it says what is needed and sends nothing', async (_what, over) => {
    setupMusic();
    stubAudio(60);
    await openMusic();

    await fillForm(over);
    await addTrack();

    expect(await screen.findByText('Fill in the title, licence, at least one mood, and choose a file.')).toBeInTheDocument();
    expect(adds()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it('a file the browser can’t read as audio is refused before anything is sent', async () => {
    setupMusic();
    stubAudio('error');
    await openMusic();

    await fillForm();
    await addTrack();

    expect(await screen.findByText('That file couldn’t be read as audio.')).toBeInTheDocument();
    expect(adds()).toHaveLength(0);
  });

  it('a file over 30 MB is refused before anything is sent', async () => {
    setupMusic();
    stubAudio(60);
    await openMusic();
    const big = mp3();
    Object.defineProperty(big, 'size', {value: 30 * 1024 * 1024 + 1});

    await fillForm({file: big});
    await addTrack();

    expect(await screen.findByText(/over 30 MB/)).toBeInTheDocument();
    expect(adds()).toHaveLength(0);
  });

  it('when the upload fails it says so, and the track is not switched on', async () => {
    setupMusic();
    stubAudio(60);
    api.on(`PUT ${UPLOAD.split('?')[0]}`, () => ({status: 403, body: {}}));
    await openMusic();

    await fillForm();
    await addTrack();

    expect(await screen.findByText(/The file couldn’t be uploaded/)).toBeInTheDocument();
    expect(adds()).toHaveLength(1);
    expect(patches()).toHaveLength(0);
    // What was typed is kept for another try.
    expect(screen.getByRole('textbox', {name: 'Title'})).toHaveValue('Night Drive');
  });

  it('shows the server’s objection to the details, and uploads nothing', async () => {
    setupMusic();
    stubAudio(60);
    api.on('POST /admin/music', () => apiError(400, 'validation_error', 'Some details need another look.', {fields: {title: 'Use 120 characters or fewer'}}));
    await openMusic();

    await fillForm();
    await addTrack();

    expect(await screen.findByText('Use 120 characters or fewer')).toBeInTheDocument();
    expect(uploads()).toHaveLength(0);
    expect(patches()).toHaveLength(0);
  });
});
