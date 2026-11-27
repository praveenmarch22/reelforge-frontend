import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {LedgerEntry} from '@/api/account';
import {setUnauthenticatedHandler} from '@/api/client';
import type {Connection, User} from '@/api/types';
import {apiError, credits, installFakeApi, user, VOICES, withBasics, type FakeApi} from '@/test/fakeApi';
import {CHANNEL, EXPIRED, openAt, polyfillDialog, stubAssign, visited} from '@/test/f7';
import {SettingsPage} from './SettingsPage';

// Screen 14 (docs/SCREENS_F8.md section 1; API A9-A12, H1-H2; PUBLISHING_YOUTUBE.md F1, F3).
// The backend is the fake `fetch` from src/test/fakeApi.ts.

let api: FakeApi;
let me: User;
let signedOut: ReturnType<typeof vi.fn>;

function setup(over: Partial<User> = {}) {
  api = installFakeApi();
  me = user({name: 'Asha Rao', niche: '', ...over});
  withBasics(api);
  api.on('GET /me', () => ({body: {user: me}}));
  api.on('PATCH /me', (req) => {
    const {defaults, ...rest} = req.body;
    me = {...me, ...rest, defaults: {...me.defaults, ...defaults}};
    return {body: {user: me}};
  });
  api.on('GET /credits/ledger', () => ({body: {items: [], nextCursor: null}}));
}

const open = (path = '/app/settings') => openAt(path, [{path: '/app/settings', element: <SettingsPage />}]);
const last = <T,>(items: T[]): T => items[items.length - 1];
const tab = (name: string) => screen.findByRole('tab', {name});
const selectedTab = () => screen.getByRole('tab', {selected: true}).textContent?.trim();
const chip = (name: string) => screen.getByRole('button', {name, pressed: undefined});
const patches = () => api.calls('PATCH /me');
const panel = () => screen.getByRole('tabpanel');
const withYouTube = (youtube: Connection | null): Partial<User> => ({connections: {youtube, instagram: null}});

function entry(n: number, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {id: `l${n}`, amount: -1, kind: 'reserve', note: `Entry ${n}`, jobId: null, projectId: null, createdAt: '2026-11-20T12:00:00Z', ...over};
}

beforeEach(() => {
  polyfillDialog();
  signedOut = vi.fn();
  setUnauthenticatedHandler(signedOut);
});
afterEach(() => {
  setUnauthenticatedHandler(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('settings: tabs', () => {
  it('opens on Profile and lists the five tabs', async () => {
    setup();
    open();

    expect(await screen.findByRole('heading', {name: 'Settings'})).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Profile', 'Defaults', 'YouTube', 'Credits', 'Security']);
    expect(selectedTab()).toBe('Profile');
    expect(screen.getByRole('tabpanel', {name: 'Profile'})).toBeInTheDocument();
  });

  it.each([
    ['profile', 'Profile'],
    ['defaults', 'Defaults'],
    ['youtube', 'YouTube'],
    ['credits', 'Credits'],
    ['security', 'Security'],
  ])('?tab=%s opens the %s tab directly', async (id, label) => {
    setup();
    open(`/app/settings?tab=${id}`);

    await tab(label);
    expect(selectedTab()).toBe(label);
    expect(screen.getByRole('tabpanel', {name: label})).toBeInTheDocument();
  });

  it('?tab=instagram (old links) opens the YouTube tab', async () => {
    setup();
    open('/app/settings?tab=instagram');

    await tab('YouTube');
    expect(selectedTab()).toBe('YouTube');
    expect(screen.getByText('YouTube Shorts')).toBeInTheDocument();
  });

  it('an unknown tab falls back to Profile', async () => {
    setup();
    open('/app/settings?tab=billing');

    await tab('Profile');
    expect(selectedTab()).toBe('Profile');
  });

  it('choosing a tab puts it in the address and shows its panel', async () => {
    setup();
    open();

    await userEvent.click(await tab('Security'));
    expect(last(visited)).toBe('/app/settings?tab=security');
    expect(screen.getByRole('heading', {name: 'Change password'})).toBeInTheDocument();

    await userEvent.click(await tab('Credits'));
    expect(last(visited)).toBe('/app/settings?tab=credits');
    expect(await screen.findByRole('meter', {name: 'Credits left'})).toBeInTheDocument();
  });

  it('the arrow keys, Home and End move between tabs and choose them (the list is one Tab stop)', async () => {
    setup();
    open();

    const first = await tab('Profile');
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(selectedTab()).toBe('Defaults');
    expect(screen.getByRole('tab', {name: 'Defaults'})).toHaveFocus();
    expect(last(visited)).toBe('/app/settings?tab=defaults');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(selectedTab()).toBe('Security'); // wraps round
    await userEvent.keyboard('{Home}');
    expect(selectedTab()).toBe('Profile');
    await userEvent.keyboard('{End}');
    expect(selectedTab()).toBe('Security');
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([screen.getByRole('tab', {name: 'Security'})]);
  });

  it('coming back from Google with ?connected=youtube shows the result once and keeps the tab', async () => {
    setup(withYouTube(CHANNEL));
    open('/app/settings?tab=youtube&connected=youtube');

    const dialog = await screen.findByRole('dialog', {name: 'YouTube connected'});
    expect(dialog).toHaveTextContent('Connected as Asha Shorts');
    await waitFor(() => expect(last(visited)).toBe('/app/settings?tab=youtube'));
    await userEvent.click(within(dialog).getByRole('button', {name: 'OK'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(selectedTab()).toBe('YouTube');
  });

  it('a failed connection explains why', async () => {
    setup();
    open('/app/settings?tab=youtube&connection_error=youtube&reason=no_channel');

    const dialog = await screen.findByRole('dialog', {name: "YouTube isn't connected"});
    expect(dialog).toHaveTextContent(/no YouTube channel yet/);
  });
});

describe('settings: profile', () => {
  it('shows the name, the email as text and the saved topics', async () => {
    setup({niche: 'Fitness, gardening'});
    open();

    expect(await screen.findByRole('textbox', {name: 'Name'})).toHaveValue('Asha Rao');
    expect(screen.getByText(me.email)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(me.email)).not.toBeInTheDocument(); // not a field
    expect(chip('Fitness')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Finance')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('textbox', {name: 'Something else'})).toHaveValue('gardening');
    expect(screen.getByText('(2 of 3)')).toBeInTheDocument();
  });

  it('saves the name and the topics as one comma-separated value: listed topics first, then the free text', async () => {
    setup({niche: 'Fitness, gardening'});
    open();

    const name = await screen.findByRole('textbox', {name: 'Name'});
    await userEvent.clear(name);
    await userEvent.type(name, '  Asha R  ');
    await userEvent.click(chip('Finance'));
    await userEvent.click(screen.getByRole('button', {name: 'Save profile'}));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toEqual({name: 'Asha R', niche: 'Fitness, Finance, gardening'});
  });

  it('allows three topics at most: the rest are locked until one is removed', async () => {
    setup({niche: 'Fitness, Finance'});
    open();

    await screen.findByRole('textbox', {name: 'Name'});
    await userEvent.click(chip('Tech'));
    expect(screen.getByText('(3 of 3)')).toBeInTheDocument();
    expect(chip('Food')).toBeDisabled();
    expect(screen.getByRole('textbox', {name: 'Something else'})).toBeDisabled();
    expect(chip('Tech')).toBeEnabled(); // a chosen one can still be removed

    await userEvent.click(chip('Tech'));
    expect(chip('Food')).toBeEnabled();
    await userEvent.type(screen.getByRole('textbox', {name: 'Something else'}), 'bonsai');
    expect(chip('Food')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', {name: 'Save profile'}));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.niche).toBe('Fitness, Finance, bonsai');
  });

  it('the free-text topic is one topic: commas become spaces and it stops at 40 characters', async () => {
    setup();
    open();

    const custom = await screen.findByRole('textbox', {name: 'Something else'});
    fireEvent.change(custom, {target: {value: 'cats, dogs,birds'}});
    expect(custom).toHaveValue('cats dogs birds');
    fireEvent.change(custom, {target: {value: 'x'.repeat(60)}});
    expect(custom).toHaveValue('x'.repeat(40));
    fireEvent.change(custom, {target: {value: 'cats, dogs'}});
    await userEvent.click(screen.getByRole('button', {name: 'Save profile'}));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.niche).toBe('cats dogs');
    expect(patches()[0].body.niche.split(',')).toHaveLength(1);
  });

  it('removing every topic saves an empty value, which clears it', async () => {
    setup({niche: 'Fitness'});
    open();

    await screen.findByRole('textbox', {name: 'Name'});
    await userEvent.click(chip('Fitness'));
    await userEvent.click(screen.getByRole('button', {name: 'Save profile'}));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.niche).toBe('');
  });

  it('needs a name: an empty one is flagged and nothing is sent', async () => {
    setup();
    open();

    const name = await screen.findByRole('textbox', {name: 'Name'});
    await userEvent.clear(name);
    await userEvent.type(name, '   ');

    expect(name).toBeInvalid();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    expect(screen.getByRole('button', {name: 'Save profile'})).toBeDisabled();
    fireEvent.submit(name.closest('form')!);
    expect(patches()).toHaveLength(0);
  });

  it('shows the server’s reason when saving fails, and "Saved." goes away after another edit', async () => {
    setup();
    open();

    const name = await screen.findByRole('textbox', {name: 'Name'});
    await userEvent.click(screen.getByRole('button', {name: 'Save profile'}));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    await userEvent.type(name, 'x');
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();

    api.on('PATCH /me', () => apiError(400, 'validation_error', 'Some details need another look.', {fields: {niche: 'Use up to three topics'}}));
    await userEvent.click(screen.getByRole('button', {name: 'Save profile'}));
    expect(await screen.findByText('Use up to three topics')).toBeInTheDocument();
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });
});

describe('settings: defaults', () => {
  const openDefaults = async () => {
    open('/app/settings?tab=defaults');
    const narrator = await screen.findByRole('combobox', {name: 'Narrator'});
    await waitFor(() => expect(within(narrator).getAllByRole('option')).toHaveLength(VOICES.length));
    return narrator;
  };

  it('shows the saved narrator, caption style and visual style', async () => {
    setup({defaults: {voiceId: 'v-laura', captionStyle: 'clean', mode: 'full_ai'}});
    const narrator = await openDefaults();

    expect(narrator).toHaveValue('v-laura');
    expect(chip('Clean')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Bold pop')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Full AI')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: /sample/i})).toBeInTheDocument();
  });

  it('saves each choice as soon as it is made, one field at a time', async () => {
    setup({defaults: {voiceId: 'v-liam', captionStyle: 'bold-pop', mode: 'faceless'}});
    const narrator = await openDefaults();

    await userEvent.selectOptions(narrator, 'v-george');
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({defaults: {voiceId: 'v-george'}});
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    await waitFor(() => expect(narrator).toHaveValue('v-george'));

    await userEvent.click(chip('Neon'));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1].body).toEqual({defaults: {captionStyle: 'neon'}});
    await waitFor(() => expect(chip('Neon')).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(chip('Full AI'));
    await waitFor(() => expect(patches()).toHaveLength(3));
    expect(patches()[2].body).toEqual({defaults: {mode: 'full_ai'}});
    await waitFor(() => expect(chip('Full AI')).toHaveAttribute('aria-pressed', 'true'));
    expect(chip('Faceless')).toHaveAttribute('aria-pressed', 'false');
  });

  it('says so when a choice wasn’t saved, and keeps showing the saved one', async () => {
    setup({defaults: {voiceId: 'v-liam', captionStyle: 'bold-pop', mode: 'faceless'}});
    api.on('PATCH /me', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    await openDefaults();

    await userEvent.click(chip('Clean'));

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
    expect(chip('Bold pop')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Clean')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('settings: YouTube', () => {
  const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth?state=abc';
  const connects = () => api.calls('GET /connections/:platform/connect');
  const disconnects = () => api.calls('DELETE /connections/:platform');

  function setupYouTube(youtube: Connection | null) {
    setup(withYouTube(youtube));
    api.on('GET /connections/:platform/connect', () => ({body: {authorizeUrl: AUTHORIZE}}));
    api.on('DELETE /connections/:platform', () => {
      me = {...me, ...withYouTube(null)};
      return {status: 204};
    });
  }

  it('not connected: Connect YouTube asks the API where to go, comes back to this tab, and leaves for Google', async () => {
    setupYouTube(null);
    const assign = stubAssign();
    open('/app/settings?tab=youtube');

    expect(await screen.findByText(/only accounts added as testers can connect/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Disconnect'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Connect YouTube'}));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
    expect(connects()).toHaveLength(1);
    expect(connects()[0].path).toBe(`/connections/youtube/connect?returnTo=${encodeURIComponent('/app/settings?tab=youtube')}`);
    // The page is leaving: the button stays busy so it can't be pressed twice.
    expect(screen.getByRole('button', {name: /Connect YouTube/})).toBeDisabled();
  });

  it('connected: shows the channel and since when, with Change channel and Disconnect', async () => {
    setupYouTube(CHANNEL);
    const assign = stubAssign();
    open('/app/settings?tab=youtube');

    expect(await screen.findByText(/Connected as/)).toHaveTextContent('Connected as Asha Shorts');
    expect(screen.getByText(/since .*2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Connect YouTube'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Disconnect'})).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', {name: 'Change channel'}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
    expect(connects()[0].path).toContain(encodeURIComponent('/app/settings?tab=youtube'));
    expect(disconnects()).toHaveLength(0);
  });

  it('Disconnect asks first; confirmed, the channel is disconnected and the tab offers Connect again', async () => {
    setupYouTube(CHANNEL);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    open('/app/settings?tab=youtube');

    await userEvent.click(await screen.findByRole('button', {name: 'Disconnect'}));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/Disconnect YouTube\?/);
    await waitFor(() => expect(disconnects()).toHaveLength(1));
    expect(disconnects()[0].path).toBe('/connections/youtube');
    expect(await screen.findByRole('button', {name: 'Connect YouTube'})).toBeInTheDocument();
    expect(within(panel()).queryByText('Asha Shorts')).not.toBeInTheDocument();
  });

  it('Disconnect not confirmed: nothing is sent and the channel stays', async () => {
    setupYouTube(CHANNEL);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    open('/app/settings?tab=youtube');

    await userEvent.click(await screen.findByRole('button', {name: 'Disconnect'}));

    expect(disconnects()).toHaveLength(0);
    expect(within(panel()).getByText('Asha Shorts')).toBeInTheDocument();
  });

  it('says so when disconnecting failed, and the channel stays', async () => {
    setupYouTube(CHANNEL);
    api.on('DELETE /connections/:platform', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open('/app/settings?tab=youtube');

    await userEvent.click(await screen.findByRole('button', {name: 'Disconnect'}));

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(within(panel()).getByText('Asha Shorts')).toBeInTheDocument();
  });

  it('a connection that needs a reconnect says it expired and offers Reconnect, not Disconnect', async () => {
    setupYouTube(EXPIRED);
    const assign = stubAssign();
    open('/app/settings?tab=youtube');

    expect(await screen.findByText(/Your YouTube connection has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Disconnect'})).not.toBeInTheDocument();
    expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Reconnect YouTube'}));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
  });

  it('says so when connecting could not start, and the button works again', async () => {
    setupYouTube(null);
    const assign = stubAssign();
    api.on('GET /connections/:platform/connect', () => apiError(503, 'provider_unavailable', 'YouTube can’t be reached right now.'));
    open('/app/settings?tab=youtube');

    await userEvent.click(await screen.findByRole('button', {name: 'Connect YouTube'}));

    expect(await screen.findByText('YouTube can’t be reached right now.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeEnabled();
  });

  it('Instagram is shown as coming soon, with nothing to press', async () => {
    setupYouTube(null);
    open('/app/settings?tab=youtube');

    const card = (await screen.findByText('Instagram Reels')).closest('div')!;
    expect(card).toHaveTextContent('Coming soon.');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('settings: credits', () => {
  const ledgerCalls = () => api.calls('GET /credits/ledger');

  it('shows the balance against the allowance as a meter, with the renewal date and no buying', async () => {
    setup();
    api.on('GET /credits', () => ({body: {...credits(86), resetsAt: '2026-12-01T12:00:00Z'}}));
    open('/app/settings?tab=credits');

    const meter = await screen.findByRole('meter', {name: 'Credits left'});
    expect(meter).toHaveAttribute('aria-valuenow', '86');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect((meter.firstElementChild as HTMLElement).style.width).toBe('86%');
    expect(screen.getByText('86').closest('p')).toHaveTextContent('86 of 100 left');
    const renews = screen.getByText(/Your credits renew on/);
    expect(renews).toHaveTextContent(/December/);
    expect(renews).toHaveTextContent(/2026/);
    expect(renews).toHaveTextContent("Buying more isn't available yet.");
    expect(screen.queryByRole('button', {name: /buy/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: /buy/i})).not.toBeInTheDocument();
  });

  it('never draws the bar wider than full when the balance is above the allowance', async () => {
    setup();
    api.on('GET /credits', () => ({body: credits(250)}));
    open('/app/settings?tab=credits');

    const meter = await screen.findByRole('meter', {name: 'Credits left'});
    expect((meter.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect(screen.getByText('250').closest('p')).toHaveTextContent('250 of 100 left');
  });

  it('lists what things cost from the API: free, one credit and several', async () => {
    setup();
    api.on('GET /credits', () => ({
      body: {...credits(86), costs: {script: 1, voicePer30s: 2, aiVideoClip: 10, ideas: 0, somethingNew: 3}},
    }));
    open('/app/settings?tab=credits');

    await screen.findByRole('heading', {name: 'What things cost'});
    const cost = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(cost('Writing a script')).toBe('1 credit');
    expect(cost('Voiceover, per 30 s')).toBe('2 credits');
    expect(cost('An AI video clip')).toBe('10 credits');
    expect(cost('Ideas')).toBe('Free');
    // Nothing is hard-coded: a price the app has no words for still shows, and one the API left out doesn't.
    expect(cost('somethingNew')).toBe('3 credits');
    expect(screen.queryByText('Rendering a video')).not.toBeInTheDocument();
  });

  it('shows the history with signed amounts, and the kind when there is no note', async () => {
    setup();
    api.on('GET /credits/ledger', () => ({
      body: {
        items: [
          entry(1, {amount: 100, kind: 'grant', note: ''}),
          entry(2, {amount: -2, kind: 'reserve', note: 'Voiceover for "Morning habits"'}),
          entry(3, {amount: 2, kind: 'refund', note: ''}),
          entry(4, {amount: -5, kind: 'adjust', note: ''}),
        ],
        nextCursor: null,
      },
    }));
    open('/app/settings?tab=credits');

    const rows = await screen.findAllByRole('row');
    const cells = rows.slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(cells.map((c) => c.slice(1))).toEqual([
      ['Monthly credits', '+100'],
      ['Voiceover for "Morning habits"', '-2'],
      ['Given back', '+2'],
      ['Adjusted by support', '-5'],
    ]);
    expect(cells[0][0]).toMatch(/November.*2026|2026.*November/);
    expect(ledgerCalls()[0].path).toBe('/credits/ledger?limit=20');
    expect(screen.queryByRole('button', {name: 'Load more'})).not.toBeInTheDocument();
  });

  it('Load more fetches the next page with the cursor and adds it below, until there is no more', async () => {
    setup();
    api.on('GET /credits/ledger', (req) => {
      const cursor = new URLSearchParams(req.path.split('?')[1]).get('cursor');
      if (!cursor) return {body: {items: [entry(1), entry(2)], nextCursor: 'next page+/='}};
      return {body: {items: [entry(3)], nextCursor: null}};
    });
    open('/app/settings?tab=credits');

    expect(await screen.findByText('Entry 2')).toBeInTheDocument();
    expect(screen.queryByText('Entry 3')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('Entry 3')).toBeInTheDocument();
    expect(screen.getByText('Entry 1')).toBeInTheDocument();
    expect(ledgerCalls()).toHaveLength(2);
    expect(ledgerCalls()[1].path).toBe(`/credits/ledger?limit=20&cursor=${encodeURIComponent('next page+/=')}`);
    await waitFor(() => expect(screen.queryByRole('button', {name: 'Load more'})).not.toBeInTheDocument());
  });

  it('an empty history says so', async () => {
    setup();
    open('/app/settings?tab=credits');

    expect(await screen.findByText('Nothing yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('when the history can’t be loaded the balance still shows, with the reason', async () => {
    setup();
    api.on('GET /credits/ledger', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    open('/app/settings?tab=credits');

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByRole('meter', {name: 'Credits left'})).toHaveAttribute('aria-valuenow', '99');
    expect(screen.queryByText('Nothing yet.')).not.toBeInTheDocument();
  });

  it('when the credits can’t be loaded it says so instead of showing numbers', async () => {
    setup();
    api.on('GET /credits', () => apiError(500, 'internal_error', 'Something went wrong on our side.'));
    open('/app/settings?tab=credits');

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});

describe('settings: security, change password', () => {
  const current = () => screen.getByLabelText('Current password');
  const next = () => screen.getByLabelText('New password');
  const again = () => screen.getByLabelText('New password again');
  const change = () => screen.getByRole('button', {name: 'Change password'});
  const sent = () => api.calls('POST /me/password');

  async function fill(c: string, n: string, a = n) {
    open('/app/settings?tab=security');
    await screen.findByRole('heading', {name: 'Change password'});
    if (c) await userEvent.type(current(), c);
    if (n) await userEvent.type(next(), n);
    if (a) await userEvent.type(again(), a);
  }

  it('changes the password, says other sessions were signed out, and empties the form', async () => {
    setup();
    api.on('POST /me/password', () => ({status: 204}));
    await fill('old-password-1', 'new-password-22');
    await userEvent.click(change());

    expect(await screen.findByText('Password changed. You were signed out everywhere else.')).toBeInTheDocument();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].body).toEqual({currentPassword: 'old-password-1', newPassword: 'new-password-22'});
    expect(current()).toHaveValue('');
    expect(next()).toHaveValue('');
    expect(again()).toHaveValue('');
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('a wrong current password is shown at that field and does not sign the user out', async () => {
    setup();
    api.on('POST /me/password', () => apiError(401, 'invalid_credentials', 'That password is not correct.'));
    await fill('not-my-password', 'new-password-22');
    await userEvent.click(change());

    expect(await screen.findByText('That isn’t your current password')).toBeInTheDocument();
    expect(current()).toBeInvalid();
    expect(current()).toHaveAccessibleDescription('That isn’t your current password');
    expect(next()).not.toBeInvalid();
    expect(signedOut).not.toHaveBeenCalled();
    expect(api.calls('POST /auth/refresh')).toHaveLength(0);
    expect(screen.queryByText(/Password changed/)).not.toBeInTheDocument();
    // Still on the page with what was typed, ready for another go.
    expect(screen.getByRole('heading', {name: 'Change password'})).toBeInTheDocument();
    expect(next()).toHaveValue('new-password-22');

    api.on('POST /me/password', () => ({status: 204}));
    await userEvent.clear(current());
    await userEvent.type(current(), 'old-password-1');
    await userEvent.click(change());
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(screen.queryByText('That isn’t your current password')).not.toBeInTheDocument();
  });

  it('two new passwords that differ are flagged and nothing is sent', async () => {
    setup();
    await fill('old-password-1', 'new-password-22', 'new-password-23');

    expect(again()).toBeInvalid();
    expect(again()).toHaveAccessibleDescription('The two passwords don’t match');
    expect(change()).toBeDisabled();
    fireEvent.submit(again().closest('form')!);
    expect(sent()).toHaveLength(0);

    await userEvent.clear(again());
    await userEvent.type(again(), 'new-password-22');
    expect(again()).not.toBeInvalid();
    expect(change()).toBeEnabled();
  });

  it('a new password under 8 characters is flagged and nothing is sent', async () => {
    setup();
    await fill('old-password-1', 'short', 'short');

    expect(next()).toHaveAccessibleDescription('Use at least 8 characters');
    expect(change()).toBeDisabled();
    fireEvent.submit(next().closest('form')!);
    expect(sent()).toHaveLength(0);
  });

  it('the button waits for all three fields', async () => {
    setup();
    await fill('', 'new-password-22');
    expect(change()).toBeDisabled();
    await userEvent.type(current(), 'old-password-1');
    expect(change()).toBeEnabled();
    await userEvent.clear(again());
    expect(change()).toBeDisabled();
  });

  it('the server’s objection to the new password is shown at that field', async () => {
    setup();
    api.on('POST /me/password', () =>
      apiError(400, 'validation_error', 'Some details need another look.', {fields: {newPassword: 'Choose a less common password'}}),
    );
    await fill('old-password-1', 'password123');
    await userEvent.click(change());

    expect(await screen.findByText('Choose a less common password')).toBeInTheDocument();
    expect(next()).toBeInvalid();
    expect(current()).not.toBeInvalid();
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('too many attempts shows the message, not a field error', async () => {
    setup();
    api.on('POST /me/password', () => apiError(429, 'rate_limited', 'Too many attempts. Try again in a minute.'));
    await fill('old-password-1', 'new-password-22');
    await userEvent.click(change());

    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeInTheDocument();
    expect(current()).not.toBeInvalid();
  });

  it('a session that really is gone (401 not_authenticated) still signs the user out', async () => {
    setup();
    api.on('POST /me/password', () => apiError(401, 'not_authenticated', 'Please log in to continue.'));
    await fill('old-password-1', 'new-password-22');
    await userEvent.click(change());

    await waitFor(() => expect(signedOut).toHaveBeenCalledTimes(1));
  });
});

describe('settings: security, delete account', () => {
  const box = () => screen.getByRole('heading', {name: 'Delete account'}).parentElement!;
  const password = () => within(box()).getByLabelText('Password');
  const remove = () => screen.getByRole('button', {name: 'Delete my account'});
  const sent = () => api.calls('DELETE /me');

  async function openSecurity() {
    open('/app/settings?tab=security');
    await screen.findByRole('heading', {name: 'Delete account'});
  }

  it('explains what is deleted and the 7 days, and waits for the password', async () => {
    setup();
    await openSecurity();

    expect(box()).toHaveTextContent(/removed for good after 7 days/);
    expect(box()).toHaveTextContent(/can't be undone/);
    expect(remove()).toBeDisabled();
  });

  it('asks to confirm; confirmed, deletes the account with the password and goes to the login page', async () => {
    setup();
    api.on('DELETE /me', () => ({status: 204}));
    const assign = stubAssign();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openSecurity();

    await userEvent.type(password(), 'my-password-1');
    await userEvent.click(remove());

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/Delete your ReelForge account/);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?deleted=1'));
    expect(sent()).toHaveLength(1);
    expect(sent()[0].body).toEqual({password: 'my-password-1'});
  });

  it('not confirmed: nothing is sent', async () => {
    setup();
    const assign = stubAssign();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openSecurity();

    await userEvent.type(password(), 'my-password-1');
    await userEvent.click(remove());

    expect(sent()).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a wrong password is shown at the field; the account stays and the user stays signed in', async () => {
    setup();
    api.on('DELETE /me', () => apiError(401, 'invalid_credentials', 'That password is not correct.'));
    const assign = stubAssign();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openSecurity();

    await userEvent.type(password(), 'not-my-password');
    await userEvent.click(remove());

    expect(await screen.findByText('That isn’t your password')).toBeInTheDocument();
    expect(password()).toBeInvalid();
    expect(assign).not.toHaveBeenCalled();
    expect(signedOut).not.toHaveBeenCalled();
    // The change-password form above is not blamed for it.
    expect(screen.getByLabelText('Current password')).not.toBeInvalid();
  });

  it('another failure shows its message and nothing leaves the page', async () => {
    setup();
    api.on('DELETE /me', () => apiError(429, 'rate_limited', 'Too many attempts. Try again in a minute.'));
    const assign = stubAssign();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openSecurity();

    await userEvent.type(password(), 'my-password-1');
    await userEvent.click(remove());

    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
