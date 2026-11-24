import {expect, type Locator, type Page} from '@playwright/test';
import type {User} from '../src/api/types';
import {DEMO_EMAIL, DEMO_PASSWORD} from '../src/mocks/db';

export {DEMO_EMAIL, DEMO_PASSWORD};

/** A made-up person for sign-up tests. Every test has its own browser storage, so the email is always free. */
export const NEW_USER = {name: 'Asha Rao', email: 'asha@example.com', password: 'Asha-test-pass-1'};

/** Titles of the demo account's Reels, by the status the seed data gives them (src/mocks/db.ts). */
export const DEMO_REELS = {
  posted: ['Morning dopamine reset', 'The 2-minute rule, explained'],
  ready: ['3 AI tools for high output'],
  generating: ['Hyperfocus in 5 minutes'],
  draft: ['Why most creators quit'],
  failed: ['Cinematic Tokyo night run'],
  rendered: ['How I plan my week on Sunday'],
};
export const ALL_DEMO_REELS = Object.values(DEMO_REELS).flat();

export const emailField = (page: Page) => page.getByLabel('Email address');
// exact: the show/hide button next to it is labelled "Show password".
export const passwordField = (page: Page) => page.getByLabel('Password', {exact: true});
export const h1 = (page: Page) => page.getByRole('heading', {level: 1});

/** Fills in and submits the login form that is on screen. */
export async function submitLogin(page: Page, email: string, password: string) {
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await page.getByRole('button', {name: 'Log in'}).click();
}

export async function loginAsDemo(page: Page) {
  await page.goto('/login');
  await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/app$/);
  await expect(h1(page)).toHaveText(/^Hey /);
}

/** Signs up a new account and stops on the "check your inbox" screen (signed in, not verified). */
export async function signUp(page: Page, user = NEW_USER) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill(user.name);
  await emailField(page).fill(user.email);
  await passwordField(page).fill(user.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(h1(page)).toHaveText('Check your inbox');
}

// --- Onboarding (F4) ---------------------------------------------------------------------------
// A new account that verifies its email is sent to /onboarding before it can use the app.

export const ONBOARDING_STEPS = {
  1: {label: 'Niche', title: 'What do you post about?'},
  2: {label: 'Voice', title: 'Pick your voice'},
  3: {label: 'Instagram', title: 'Connect Instagram'},
} as const;
export type OnboardingStep = keyof typeof ONBOARDING_STEPS;

export const setupSteps = (page: Page) => page.getByRole('list', {name: 'Setup steps'});
/** The entry of the stepper that is marked as the current step. */
export const currentSetupStep = (page: Page) => setupSteps(page).locator('[aria-current="step"]');

/** This onboarding step is on screen, and the stepper says so. */
export async function expectOnboardingStep(page: Page, step: OnboardingStep, title: string = ONBOARDING_STEPS[step].title) {
  await expect(page).toHaveURL(/\/onboarding(\?|$)/);
  await expect(h1(page)).toHaveText(title);
  await expect(currentSetupStep(page)).toHaveCount(1);
  await expect(currentSetupStep(page)).toContainText(ONBOARDING_STEPS[step].label);
}

/** On the "check your inbox" screen: opens the emailed link. A newly verified account lands on onboarding step 1. */
export async function openVerificationLink(page: Page) {
  await page.getByRole('link', {name: 'Open the verification link'}).click();
  await expectOnboardingStep(page, 1);
}

/** On any onboarding step: leaves the setup with "Skip setup" and waits for the dashboard. */
export async function skipSetup(page: Page) {
  await page.getByRole('button', {name: 'Skip setup'}).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(h1(page)).toHaveText(/^Welcome, /);
}

/** The page title while this onboarding step is on screen. */
export const onboardingTitle = (step: OnboardingStep) => `${ONBOARDING_STEPS[step].label} · ReelForge setup`;

/** Signs up, verifies the email, and stops on the given onboarding step (later steps are reached with "Skip for now"). */
export async function startOnboarding(page: Page, step: OnboardingStep = 1, user = NEW_USER) {
  await signUp(page, user);
  await openVerificationLink(page);
  for (let at = 1; at < step; at++) {
    await page.getByRole('button', {name: 'Skip for now'}).click();
    await expectOnboardingStep(page, (at + 1) as OnboardingStep);
  }
}

/** The signed-in user as the API reports it. */
export async function currentUser(page: Page): Promise<User> {
  return (await apiGet<{user: User}>(page, '/me')).user;
}

/**
 * Changes the signed-in user's profile through the API (A10), the way Settings or another client
 * would. The open page does not know about it; reload to see the change.
 */
export async function patchProfile(page: Page, body: {niche?: string; defaults?: Partial<User['defaults']>}): Promise<User> {
  const result = await page.evaluate(async (b) => {
    const res = await fetch('/api/v1/me', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)});
    return {status: res.status, body: (await res.json()) as {user: User}};
  }, body);
  expect(result.status, 'PATCH /me').toBe(200);
  return result.body.user;
}

/** Ends the session the way an expired one ends; the setup screens have no log-out control. */
export async function endSession(page: Page) {
  await page.evaluate(() => fetch('/api/v1/auth/logout', {method: 'POST'}));
}

/** One entry of the setup stepper, by its position (1 to 3). */
export const setupStep = (page: Page, step: OnboardingStep) => setupSteps(page).getByRole('listitem').nth(step - 1);

/**
 * What the stepper says about a step other than the current one.
 * done: the choice is saved (a tick instead of the number, and "(done)" for screen readers).
 * skipped: passed without saving (the number, and "(skipped)" for screen readers).
 * ahead: not reached and nothing saved (the number only).
 */
export async function expectSetupStepState(page: Page, step: OnboardingStep, state: 'done' | 'skipped' | 'ahead' | 'current') {
  const {label} = ONBOARDING_STEPS[step];
  const text = {
    done: new RegExp(`^${label} ?\\(done\\)$`),
    skipped: new RegExp(`^${step} ?${label} ?\\(skipped\\)$`),
    ahead: new RegExp(`^${step} ?${label}$`),
    current: new RegExp(`^${step} ?${label}$`),
  }[state];
  await expect(setupStep(page, step), `step ${step} (${label}) is shown as ${state}`).toHaveText(text);
  if (state === 'current') await expect(setupStep(page, step)).toHaveAttribute('aria-current', 'step');
  else await expect(setupStep(page, step)).not.toHaveAttribute('aria-current');
}

export async function openProjects(page: Page) {
  await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Projects'}).click();
  await expect(h1(page)).toHaveText('Your Reels');
}

/** The card of the Reel with this title. */
export const reelCard = (page: Page, title: string): Locator =>
  page.getByRole('article').filter({has: page.getByRole('heading', {name: title, exact: true})});

/** Exactly these Reels are on screen, in any order. */
export async function expectReels(page: Page, titles: string[]) {
  await expect(page.getByRole('article')).toHaveCount(titles.length);
  for (const title of titles) await expect(reelCard(page, title)).toBeVisible();
}

/**
 * Keeps the Reels that are generating where they are. Call before the first page.goto of the test.
 *
 * The mock API moves a generating Reel forward by a few percent on every GET /projects and makes it
 * "ready" at 100%, and the app polls every 2 seconds while one is generating. A test that needs the
 * Reel to still be generating would otherwise depend on how many polls fit in before its assertion,
 * that is, on how fast the machine is. With this, each poll starts from the progress the Reel had
 * when the page first asked, so its status never changes. The mock database is read and written
 * through the app's own module (the dev server serves it), not through a copied storage key.
 */
export async function holdGeneratingReels(page: Page) {
  await page.addInitScript(() => {
    type MockDb = {projects: {id: string; status: string; progress: number | null}[]};
    type MockDbModule = {loadDb: () => MockDb; saveDb: (db: MockDb) => void};
    const modulePath = '/src/mocks/db.ts';
    const held = new Map<string, number>();
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method === 'GET' && new URL(href, location.href).pathname === '/api/v1/projects') {
        const {loadDb, saveDb} = (await import(/* @vite-ignore */ modulePath)) as MockDbModule;
        const db = loadDb();
        for (const p of db.projects) {
          if (p.status !== 'generating') continue;
          if (!held.has(p.id)) held.set(p.id, p.progress ?? 0);
          p.progress = held.get(p.id) ?? 0;
        }
        saveDb(db);
      }
      return realFetch(input, init);
    };
  });
}

export const deleteDialog =(page: Page) => page.getByRole('dialog', {name: 'Delete this Reel?'});

/** Opens the delete confirmation for the Reel with this title, from its options menu. */
export async function askToDelete(page: Page, title: string) {
  await reelCard(page, title).hover();
  await page.getByRole('button', {name: `More options for ${title}`}).click();
  await page.getByRole('menuitem', {name: 'Delete'}).click();
  await expect(deleteDialog(page)).toBeVisible();
  await expect(deleteDialog(page)).toContainText(title);
}

export async function logOut(page: Page) {
  await page.getByRole('button', {name: 'Account menu'}).click();
  await page.getByRole('menuitem', {name: 'Log out'}).click({timeout: 10_000});
  await expect(page).toHaveURL(/\/login$/);
}

/** Presses Tab until the element has focus, the way a keyboard user reaches it. */
export async function tabTo(page: Page, target: Locator, maxTabs = 25) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Could not reach the element with ${maxTabs} Tab presses`);
}

/** Visible form controls, buttons and links that a screen reader would announce without a name. */
export function controlsWithoutAName(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (el: Element): string => {
      const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => text(document.getElementById(id)))
        .join(' ');
      if (labelledBy.trim()) return labelledBy;
      const ariaLabel = el.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const label = Array.from(el.labels ?? []).map(text).join(' ').trim();
        // A placeholder alone does not count as a name.
        return label || (el.getAttribute('title') ?? '').trim();
      }
      const imageAlt = Array.from(el.querySelectorAll('img[alt]'))
        .map((img) => img.getAttribute('alt'))
        .join(' ');
      return text(el) || imageAlt.trim() || (el.getAttribute('title') ?? '').trim();
    };
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
    };
    return Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a[href], [role="button"]'))
      .filter(visible)
      .filter((el) => !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 160));
  });
}

/** Buttons inside links and links inside buttons: invalid HTML that gives one action two tab stops. */
export function nestedInteractiveControls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a button, button a, a a, button button')).map((el) => el.outerHTML.slice(0, 160)),
  );
}

// --- Failure injection -------------------------------------------------------------------------
// The mock API runs in a service worker, which Playwright's page.route cannot see. These helpers
// wrap window.fetch in the page instead, so a test can make chosen API calls fail, stall, or
// answer with a given body, the way a real backend or a bad connection would.

export type Fault = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path under /api/v1, for example "/projects". End with * to match everything that starts with it. */
  path: string;
  /** HTTP status to answer with; 0 drops the connection. Leave out to let the request through (use with delayMs). */
  status?: number;
  code?: string;
  message?: string;
  /** Full response body, instead of the error envelope built from code and message. */
  body?: unknown;
  /** How many matching requests to affect; all of them when left out. */
  times?: number;
  delayMs?: number;
  /**
   * Keeps the request waiting until the test calls releaseHeldRequests, then lets it through (or answers
   * with status). For checking what the screen does while a request is in flight, however slow the machine is.
   */
  hold?: boolean;
};

const FAULTS_KEY = '__rf_test_faults';
const RELEASE_KEY = '__rf_test_release';

/** Call once, before the first page.goto of the test. */
export async function installFaultInjection(page: Page) {
  await page.addInitScript(([key, releaseKey]) => {
    type Rule = {method: string; path: string; status?: number; code?: string; message?: string; body?: unknown; times?: number; delayMs?: number; hold?: boolean; hits?: number};
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      let rules: Rule[] = [];
      try {
        rules = JSON.parse(sessionStorage.getItem(key) ?? '[]') as Rule[];
      } catch {
        rules = [];
      }
      const rule = rules.find((r) => {
        const full = `/api/v1${r.path}`;
        const pathMatches = full.endsWith('*') ? url.pathname.startsWith(full.slice(0, -1)) : url.pathname === full;
        return r.method === method && pathMatches && (r.times === undefined || r.times > 0);
      });
      if (!rule) return realFetch(input, init);
      if (rule.times !== undefined) rule.times--;
      rule.hits = (rule.hits ?? 0) + 1;
      sessionStorage.setItem(key, JSON.stringify(rules));
      if (rule.delayMs) await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
      if (rule.hold) {
        await new Promise<void>((resolve) => {
          const check = () => (sessionStorage.getItem(releaseKey) ? resolve() : void setTimeout(check, 25));
          check();
        });
      }
      if (rule.status === undefined) return realFetch(input, init);
      if (rule.status === 0) throw new TypeError('Failed to fetch');
      const body = rule.body ?? {
        error: {code: rule.code ?? 'internal_error', message: rule.message ?? 'Something went wrong on our side.'},
      };
      return new Response(JSON.stringify(body), {status: rule.status, headers: {'Content-Type': 'application/json'}});
    };
  }, [FAULTS_KEY, RELEASE_KEY] as const);
}

/** Replaces the active faults. They live in the tab's sessionStorage, so they survive reloads. Pass [] to clear. */
export async function setFaults(page: Page, faults: Fault[]) {
  await page.evaluate(
    ([key, value, releaseKey]) => {
      sessionStorage.removeItem(releaseKey);
      sessionStorage.setItem(key, value);
    },
    [FAULTS_KEY, JSON.stringify(faults), RELEASE_KEY] as const,
  );
}

/** Lets the requests that a fault with `hold` is keeping back go on their way. */
export async function releaseHeldRequests(page: Page) {
  await page.evaluate((releaseKey) => sessionStorage.setItem(releaseKey, '1'), RELEASE_KEY);
}

/** How many requests the fault at this position has caught so far. */
export function faultHits(page: Page, index = 0): Promise<number> {
  return page.evaluate(
    ([key, i]) => (JSON.parse(sessionStorage.getItem(key as string) ?? '[]')[i as number]?.hits as number) ?? 0,
    [FAULTS_KEY, index] as const,
  );
}

/** Calls the mock API from inside the page and returns the JSON body. */
export function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => (await fetch(`/api/v1${p}`)).json(), path) as Promise<T>;
}

/** True when nothing on the page sticks out sideways (no horizontal scrolling anywhere in the layout). */
export function fitsViewportWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return (
      document.documentElement.scrollWidth <= window.innerWidth && (!main || main.scrollWidth <= main.clientWidth)
    );
  });
}
