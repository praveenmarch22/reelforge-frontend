import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {api as call} from '@/api/client';
import {AppShell} from '@/components/layout/AppShell';
import {apiError, installFakeApi, withBasics, type FakeApi} from '@/test/fakeApi';
import {openAt, polyfillDialog} from '@/test/f7';
import {OutOfCredits} from './OutOfCredits';

// Screen 15 (docs/SCREENS_F8.md section 2): any action answered with 402 insufficient_credits
// opens one dialog, wherever it happened. The backend is the fake `fetch` from src/test/fakeApi.ts.

let api: FakeApi;

/** A page that spends credits when its button is pressed, like any screen of the app. */
function Spender({path = '/projects/p1/generate'}: {path?: string}) {
  return (
    <button type="button" onClick={() => void call(path, {method: 'POST', body: {}}).catch(() => {})}>
      Spend
    </button>
  );
}

function Page({path}: {path?: string}) {
  return (
    <>
      <Spender path={path} />
      <OutOfCredits />
    </>
  );
}

const RENEWS = '2026-12-01T12:00:00Z'; // midday, so it is 1 December in every time zone
const refuse = (details?: Record<string, unknown>) =>
  api.on('POST /projects/:id/generate', () => apiError(402, 'insufficient_credits', 'You need more credits.', details));
const open = () => openAt('/app/p/p1/edit', [{path: '/app/p/:id/edit', element: <Page />}]);
const spend = () => userEvent.click(screen.getByRole('button', {name: 'Spend'}));

beforeEach(() => {
  polyfillDialog();
  api = installFakeApi();
  withBasics(api);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('out of credits dialog', () => {
  it('opens on a 402 and says what was needed, the balance and when credits renew', async () => {
    refuse({needed: 10, balance: 3, resetsAt: RENEWS});
    open();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await spend();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/credits/i);
    expect(dialog).toHaveTextContent('This needs 10 credits and you have 3.');
    expect(dialog).toHaveTextContent(/Your credits renew on (1 December|December 1)\b/);
  });

  it('with nothing left it is titled "You\'re out of credits", and one credit is singular', async () => {
    refuse({needed: 1, balance: 0, resetsAt: RENEWS});
    open();

    await spend();

    const dialog = await screen.findByRole('dialog', {name: "You're out of credits"});
    expect(dialog).toHaveTextContent('This needs 1 credit and you have 0.');
  });

  it('"See my credits" closes it and opens the Credits tab of settings', async () => {
    refuse({needed: 10, balance: 3, resetsAt: RENEWS});
    open();
    await spend();

    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name: 'See my credits'}));

    expect(await screen.findByTestId('where')).toHaveTextContent('/app/settings?tab=credits');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Close closes it and stays on the page; the next 402 opens it again with the new numbers', async () => {
    refuse({needed: 10, balance: 3, resetsAt: RENEWS});
    open();
    await spend();

    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name: 'Close'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Spend'})).toBeInTheDocument();

    refuse({needed: 4, balance: 2, resetsAt: RENEWS});
    await spend();
    expect(await screen.findByRole('dialog')).toHaveTextContent('This needs 4 credits and you have 2.');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('still makes sense when the API sends no details', async () => {
    refuse();
    open();

    await spend();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This needs more credits.');
    expect(dialog).toHaveTextContent('Your credits renew at the start of next month.');
    expect(dialog).not.toHaveTextContent(/undefined|NaN|null|Invalid/);
  });

  it.each([
    ['another 402', 402, 'payment_required'],
    ['a 409', 409, 'already_running'],
    ['a 503', 503, 'provider_unavailable'],
  ])('does not open for %s', async (_what, status, code) => {
    api.on('POST /projects/:id/generate', () => apiError(status, code, 'No.'));
    open();

    await spend();

    await waitFor(() => expect(api.calls('POST /projects/:id/generate')).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from anywhere: a different endpoint on a different page', async () => {
    api.on('POST /scenes/:id/visual/regenerate', () =>
      apiError(402, 'insufficient_credits', 'You need more credits.', {needed: 1, balance: 0}),
    );
    openAt('/app/new', [{path: '/app/new', element: <Page path="/scenes/s1/visual/regenerate" />}]);

    await spend();

    expect(await screen.findByRole('dialog')).toHaveTextContent('This needs 1 credit and you have 0.');
  });

  it('is part of the app shell, so every page inside it gets the dialog', async () => {
    refuse({needed: 10, balance: 3, resetsAt: RENEWS});
    // The shell alone: its own <Outlet /> is empty here, the request stands in for any page's.
    openAt('/app', [{path: '/app', element: <AppShell />}]);
    await screen.findByRole('navigation', {name: 'Main'});

    await call('/projects/p1/generate', {method: 'POST', body: {}}).catch(() => {});

    expect(await screen.findByRole('dialog')).toHaveTextContent('This needs 10 credits and you have 3.');
  });

  it('after the page with the dialog has gone, a 402 elsewhere does nothing and breaks nothing', async () => {
    refuse({needed: 10, balance: 3});
    const view = open();
    view.unmount();

    await expect(call('/projects/p1/generate', {method: 'POST', body: {}})).rejects.toMatchObject({
      status: 402,
      code: 'insufficient_credits',
    });
  });
});
