import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {User} from '@/api/types';
import {loadDb, toUser} from '@/mocks/db';
import {InstagramStep, toReason} from './InstagramStep';

// Step 3 of onboarding. API F2: the result comes back in the address as instagram=connected, or
// instagram=error&reason=personal_account|denied|not_tester|failed, and "the web app treats any
// reason it does not know as failed". The address bar is user input, so anything can arrive there.

const GENERIC = 'Something went wrong while connecting. Please try again.';
const KNOWN = ['personal_account', 'denied', 'not_tester', 'failed'] as const;
// Names that every JavaScript object has; `reason=__proto__` used to blank the page (QA-028).
const INHERITED_NAMES = ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];
const UNKNOWN = [...INHERITED_NAMES, 'banana', '', ' ', 'FAILED', 'Denied', 'denied ', 'personal-account', '0', 'null', 'undefined', '<b>x</b>'];

function newUser(over: Partial<User> = {}): User {
  const db = loadDb();
  return {
    ...toUser(db, db.users[0]),
    onboardingCompleted: false,
    instagram: {connected: false, username: null, status: null, expiresAt: null},
    ...over,
  };
}

function renderStep(props: {result?: string | null; reason?: string | null; user?: User} = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const onBack = vi.fn();
  const onFinish = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/onboarding?step=3']} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <InstagramStep
          user={props.user ?? newUser()}
          result={props.result ?? null}
          reason={props.reason ?? null}
          onBack={onBack}
          onFinish={onFinish}
          finishing={false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {onBack, onFinish};
}

const button = (name: string) => screen.getByRole('button', {name});

describe('toReason', () => {
  it.each(KNOWN)('keeps the documented reason %s', (reason) => {
    expect(toReason(reason)).toBe(reason);
  });

  it.each(UNKNOWN)('treats the unknown reason %j as "failed"', (reason) => {
    expect(toReason(reason)).toBe('failed');
  });

  it('treats a missing reason as "failed"', () => {
    expect(toReason(null)).toBe('failed');
  });
});

describe('InstagramStep: the failure message', () => {
  it.each(UNKNOWN)('instagram=error with the unknown reason %j shows the generic failure and "Try again"', (reason) => {
    renderStep({result: 'error', reason});

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't connect your account");
    expect(alert).toHaveTextContent(GENERIC);
    expect(button('Try again')).toBeEnabled();
    expect(button('Skip for now')).toBeEnabled();
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Connect Instagram');
  });

  it('instagram=error with no reason at all shows the generic failure', () => {
    renderStep({result: 'error', reason: null});

    expect(screen.getByRole('alert')).toHaveTextContent(GENERIC);
  });

  it('each documented reason shows a message of its own', () => {
    const messages = KNOWN.map((reason) => {
      renderStep({result: 'error', reason});
      const text = screen.getByRole('alert').textContent ?? '';
      cleanupRender();
      return text;
    });

    expect(new Set(messages).size).toBe(KNOWN.length);
    for (const text of messages) expect(text.length).toBeGreaterThan("We couldn't connect your account".length);
    expect(messages[KNOWN.indexOf('failed')]).toContain(GENERIC);
  });

  it.each(['connected', 'banana', '__proto__', null])('instagram=%s without a connection shows no failure and offers to connect', (result) => {
    renderStep({result});

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(button('Connect Instagram')).toBeEnabled();
    expect(screen.queryByRole('button', {name: 'Finish'})).not.toBeInTheDocument();
  });

  // PRD flow 2 step 5: "show Connected as @username".
  it('a connected account shows "Connected as @username" under "Instagram connected", whatever the address says', () => {
    const connected = newUser({instagram: {connected: true, username: 'asha_creates', status: 'connected', expiresAt: null}});
    renderStep({user: connected, result: 'error', reason: 'denied'});

    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Instagram connected');
    expect(screen.getByText('Connected as @asha_creates')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(button('Finish')).toBeEnabled();
    expect(screen.queryByRole('button', {name: 'Skip for now'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Connect Instagram'})).not.toBeInTheDocument();
  });
});

// The helper above renders several times in one test; this unmounts in between.
function cleanupRender() {
  document.body.innerHTML = '';
}

// QA-033: after "Connect Instagram" the browser leaves for Instagram. If the visitor presses Back
// there, browsers usually bring this page back exactly as it was left (back/forward cache). The
// buttons must then work again. The dev server cannot use that cache, so this is checked here.
describe('InstagramStep: coming back from Instagram with the browser Back button', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  /** F1 answers with a place to go. A "#..." address lets the test environment follow it without leaving the page. */
  function answerConnectWith(authorizeUrl: string) {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify({authorizeUrl}), {status: 200, headers: {'Content-Type': 'application/json'}}));
  }

  const pageShow = (persisted: boolean) =>
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted}));
    });

  it('keeps the buttons busy once the browser has been sent to Instagram, and frees them when the page is shown again from the cache', async () => {
    const fetchSpy = answerConnectWith('#instagram-approval');
    const {onBack, onFinish} = renderStep();

    await userEvent.click(button('Connect Instagram'));

    // The browser was sent on its way...
    await waitFor(() => expect(window.location.hash).toBe('#instagram-approval'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`/instagram/connect?returnTo=${encodeURIComponent('/onboarding?step=3')}`);
    // ...and until the page goes away nothing else can be started from it.
    await waitFor(() => expect(button('Connect Instagram')).toHaveAttribute('aria-busy', 'true'));
    expect(button('Connect Instagram')).toBeDisabled();
    expect(button('Back')).toBeDisabled();
    expect(button('Skip for now')).toBeDisabled();

    // An ordinary page show (not from the cache) changes nothing.
    pageShow(false);
    expect(button('Connect Instagram')).toBeDisabled();

    // Shown again from the back/forward cache: usable again.
    pageShow(true);
    await waitFor(() => expect(button('Connect Instagram')).toBeEnabled());
    expect(button('Connect Instagram')).not.toHaveAttribute('aria-busy');
    expect(button('Back')).toBeEnabled();
    expect(button('Skip for now')).toBeEnabled();

    await userEvent.click(button('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.click(button('Skip for now'));
    expect(onFinish).toHaveBeenCalledTimes(1);
    await userEvent.click(button('Connect Instagram'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});
