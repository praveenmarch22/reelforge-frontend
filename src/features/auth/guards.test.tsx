import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {describe, expect, it} from 'vitest';
import type {User} from '@/api/types';
import {loadDb, toUser} from '@/mocks/db';
import {OnboardingGate} from './guards';

// PRD flow 1: after verifying, a new user goes through onboarding once. Unverified users are
// not sent there; they see the "verify your email" banner in the app first.

function demoUser(): User {
  const db = loadDb();
  return toUser(db, db.users[0]);
}
const newVerifiedUser = (): User => ({...demoUser(), emailVerified: true, onboardingCompleted: false});

/** Stands in for a page and shows the address the visitor ended on. */
function Screen({name}: {name: string}) {
  const {pathname, search} = useLocation();
  return (
    <p>
      {name} screen at <span data-testid="address">{pathname + search}</span>
    </p>
  );
}

function renderAppPage(user: User | null, path = '/app') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  client.setQueryData(['me'], user); // the signed-in user, as RequireAuth has already loaded it
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <Routes>
          <Route path="/onboarding" element={<Screen name="onboarding" />} />
          <Route element={<OnboardingGate />}>
            <Route path="/app" element={<Screen name="dashboard" />} />
            <Route path="/app/projects" element={<Screen name="library" />} />
            <Route path="/app/settings" element={<Screen name="settings" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const address = () => screen.getByTestId('address').textContent;
/** The query string of the address the visitor ended on, as a plain object. */
const query = () => Object.fromEntries(new URLSearchParams(address()!.split('?')[1] ?? ''));

describe('OnboardingGate', () => {
  it('sends a verified user who has not done the setup to onboarding', () => {
    renderAppPage(newVerifiedUser());

    expect(screen.getByText(/onboarding screen/)).toBeInTheDocument();
    expect(screen.queryByText(/dashboard screen/)).not.toBeInTheDocument();
    expect(address()).toBe('/onboarding');
  });

  it('does so from every app page, not only the dashboard', () => {
    renderAppPage(newVerifiedUser(), '/app/projects');

    expect(address()).toBe('/onboarding');
  });

  it('lets an unverified user into the app, even though the setup is not done', () => {
    renderAppPage({...demoUser(), emailVerified: false, onboardingCompleted: false});

    expect(screen.getByText(/dashboard screen/)).toBeInTheDocument();
  });

  it('lets a user who has completed the setup into the app', () => {
    renderAppPage({...demoUser(), emailVerified: true, onboardingCompleted: true}, '/app/projects');

    expect(screen.getByText(/library screen/)).toBeInTheDocument();
  });

  // API F2: a connect attempt that fails outright (state missing, expired, used, or another user's)
  // redirects to /app/settings?instagram=error&reason=failed. A user who is still in the setup cannot
  // open Settings, so the result has to travel with them to the setup's Instagram step.
  describe('an Instagram result that arrives on an app page during the setup', () => {
    it('is carried to step 3 of the setup', () => {
      renderAppPage(newVerifiedUser(), '/app/settings?instagram=error&reason=failed');

      expect(screen.getByText(/onboarding screen/)).toBeInTheDocument();
      expect(query()).toEqual({step: '3', instagram: 'error', reason: 'failed'});
    });

    it.each(['personal_account', 'denied', 'not_tester'])('keeps the reason %s', (reason) => {
      renderAppPage(newVerifiedUser(), `/app/settings?instagram=error&reason=${reason}`);

      expect(query()).toEqual({step: '3', instagram: 'error', reason});
    });

    it('carries a success too, and adds no reason when there is none', () => {
      renderAppPage(newVerifiedUser(), '/app/settings?instagram=connected');

      expect(query()).toEqual({step: '3', instagram: 'connected'});
    });

    it('is carried from any app page, and nothing else from the address comes along', () => {
      renderAppPage(newVerifiedUser(), '/app/projects?q=tokyo&instagram=error&reason=denied&step=1');

      expect(query()).toEqual({step: '3', instagram: 'error', reason: 'denied'});
    });

    it('keeps a reason with unusual characters as one value, so it cannot add parameters of its own', () => {
      const reason = 'a&step=1&x=y#z';
      renderAppPage(newVerifiedUser(), `/app/settings?instagram=error&reason=${encodeURIComponent(reason)}`);

      expect(query()).toEqual({step: '3', instagram: 'error', reason});
    });

    it('a reason without an instagram result is not a result: the setup opens on its first step', () => {
      renderAppPage(newVerifiedUser(), '/app/settings?reason=failed');

      expect(address()).toBe('/onboarding');
    });

    it('stays on the page it arrived on for a user who has completed the setup', () => {
      renderAppPage({...demoUser(), emailVerified: true, onboardingCompleted: true}, '/app/settings?instagram=error&reason=failed');

      expect(screen.getByText(/settings screen/)).toBeInTheDocument();
      expect(address()).toBe('/app/settings?instagram=error&reason=failed');
    });

    it('stays on the page it arrived on for an unverified user', () => {
      renderAppPage({...demoUser(), emailVerified: false, onboardingCompleted: false}, '/app/settings?instagram=error&reason=failed');

      expect(address()).toBe('/app/settings?instagram=error&reason=failed');
    });
  });
});
