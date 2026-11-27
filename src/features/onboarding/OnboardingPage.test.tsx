import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Connection} from '@/api/types';
import {REASONS} from '@/features/publish/ConnectionResult';
import {apiError, installFakeApi, user, withBasics, type FakeApi} from '@/test/fakeApi';
import {CHANNEL, EXPIRED, openAt, stubAssign, visited} from '@/test/f7';
import {OnboardingPage} from './OnboardingPage';

// Onboarding step 3 (docs/SCREENS_F7.md section 6; FIX_LOG_F7 QF7-006): connect YouTube (F1),
// read the result Google sends back once and remove it from the address, Skip and Finish (A10).

let api: FakeApi;
let me: Connection | null;

function setup(youtube: Connection | null = null) {
  api = installFakeApi();
  me = youtube;
  withBasics(api);
  api.on('GET /me', () => ({body: {user: user({onboardingCompleted: false, emailVerified: true, connections: {youtube: me, instagram: null}})}}));
  api.on('PATCH /me', (req) => ({
    body: {user: user({...req.body, emailVerified: true, connections: {youtube: me, instagram: null}})},
  }));
}

const open = (path = '/onboarding?step=3') => openAt(path, [{path: '/onboarding', element: <OnboardingPage />}]);
const last = () => visited[visited.length - 1];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Onboarding step 3: YouTube', () => {
  it('not connected: explains, offers Connect YouTube and Skip, and the stepper names the YouTube step', async () => {
    setup();
    open();
    expect(await screen.findByRole('heading', {level: 1, name: 'Connect YouTube'})).toBeInTheDocument();
    expect(screen.getByText(/Publish your Reels as YouTube Shorts straight from ReelForge/)).toBeInTheDocument();
    expect(screen.getByText(/only accounts added as testers can connect/)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Skip for now'})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeEnabled();
    const steps = screen.getByRole('list', {name: 'Setup steps'});
    expect(steps).toHaveTextContent(/Niche.*Voice.*YouTube/);
    expect(steps).not.toHaveTextContent(/Instagram/);
    expect(document.title).toBe('YouTube · ReelForge setup');
  });

  it('Connect YouTube calls F1 with returnTo /onboarding?step=3, goes to Google, and the buttons stay busy', async () => {
    setup();
    api.on('GET /connections/:platform/connect', () => ({body: {authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=z'}}));
    const assign = stubAssign();
    open();
    await userEvent.click(await screen.findByRole('button', {name: 'Connect YouTube'}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=z'));
    expect(api.calls('GET /connections/:platform/connect')[0].path).toBe(
      `/connections/youtube/connect?returnTo=${encodeURIComponent('/onboarding?step=3')}`,
    );
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Skip for now'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Back'})).toBeDisabled();
  });

  it('a refused connect shows why', async () => {
    setup();
    api.on('GET /connections/:platform/connect', () => apiError(503, 'provider_unavailable', 'YouTube publishing is not set up yet.'));
    open();
    await userEvent.click(await screen.findByRole('button', {name: 'Connect YouTube'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube publishing is not set up yet.');
    expect(screen.getByRole('button', {name: 'Connect YouTube'})).toBeEnabled();
  });

  it('a connection that needs renewing offers Reconnect YouTube', async () => {
    setup(EXPIRED);
    open();
    expect(await screen.findByRole('button', {name: 'Reconnect YouTube'})).toBeEnabled();
  });

  it('back from Google connected: "Connected as" the channel, Finish, and the result leaves the address', async () => {
    setup(CHANNEL);
    open('/onboarding?step=3&connected=youtube');
    expect(await screen.findByRole('heading', {level: 1, name: 'YouTube connected'})).toBeInTheDocument();
    expect(screen.getByText('Connected as Asha Shorts')).toBeInTheDocument();
    await waitFor(() => expect(last()).toBe('/onboarding?step=3'));
    // Read once: the screen keeps saying so after the address is cleaned.
    expect(screen.getByText('Connected as Asha Shorts')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Skip for now'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Finish'})).toBeEnabled();
  });

  it('already connected (no result in the address): "Connected:" the channel, address unchanged', async () => {
    setup(CHANNEL);
    open();
    expect(await screen.findByText('Connected: Asha Shorts')).toBeInTheDocument();
    expect(visited).toEqual(['/onboarding?step=3']);
  });

  it.each([
    ['denied', REASONS.denied],
    ['missing_permission', REASONS.missing_permission],
    ['failed', REASONS.failed],
    ['nonsense', REASONS.failed],
  ])('back from Google with reason %s: the reason, Try again, and the result leaves the address', async (reason, text) => {
    setup();
    open(`/onboarding?step=3&connection_error=youtube&reason=${reason}`);
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent("We couldn't connect your channel");
    expect(notice).toHaveTextContent(text);
    expect(screen.queryByRole('link', {name: /create a youtube channel/i})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Try again'})).toBeEnabled();
    await waitFor(() => expect(last()).toBe('/onboarding?step=3'));
    expect(screen.getByRole('alert')).toHaveTextContent(text); // still shown after the address is cleaned
  });

  it('no_channel links to creating a YouTube channel', async () => {
    setup();
    open('/onboarding?step=3&connection_error=youtube&reason=no_channel');
    const link = await screen.findByRole('link', {name: 'Create a YouTube channel'});
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/create_channel');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('alert')).toHaveTextContent(REASONS.no_channel);
  });

  it('Skip for now finishes the setup (A10 onboardingCompleted) and opens the dashboard', async () => {
    setup();
    open();
    await userEvent.click(await screen.findByRole('button', {name: 'Skip for now'}));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/app'));
    expect(api.calls('PATCH /me')).toHaveLength(1);
    expect(api.calls('PATCH /me')[0].body).toEqual({onboardingCompleted: true});
    expect(api.calls('GET /connections/:platform/connect')).toHaveLength(0);
  });

  it('Finish after connecting finishes the setup and opens the dashboard', async () => {
    setup(CHANNEL);
    open('/onboarding?step=3&connected=youtube');
    await userEvent.click(await screen.findByRole('button', {name: 'Finish'}));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/app'));
    expect(api.calls('PATCH /me')[0].body).toEqual({onboardingCompleted: true});
  });

  it('a failed finish says why and stays', async () => {
    setup(CHANNEL);
    api.on('PATCH /me', () => apiError(500, 'internal_error', 'Something failed on our side.'));
    open();
    await userEvent.click(await screen.findByRole('button', {name: 'Finish'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed on our side.');
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('Back goes to the voice step', async () => {
    setup();
    open();
    await userEvent.click(await screen.findByRole('button', {name: 'Back'}));
    await waitFor(() => expect(last()).toBe('/onboarding?step=2'));
  });
});
