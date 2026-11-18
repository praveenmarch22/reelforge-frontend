import {expect, type Locator, type Page} from '@playwright/test';
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

export const deleteDialog = (page: Page) => page.getByRole('dialog', {name: 'Delete this Reel?'});

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
};

const FAULTS_KEY = '__rf_test_faults';

/** Call once, before the first page.goto of the test. */
export async function installFaultInjection(page: Page) {
  await page.addInitScript((key) => {
    type Rule = {method: string; path: string; status?: number; code?: string; message?: string; body?: unknown; times?: number; delayMs?: number; hits?: number};
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
      if (rule.status === undefined) return realFetch(input, init);
      if (rule.status === 0) throw new TypeError('Failed to fetch');
      const body = rule.body ?? {
        error: {code: rule.code ?? 'internal_error', message: rule.message ?? 'Something went wrong on our side.'},
      };
      return new Response(JSON.stringify(body), {status: rule.status, headers: {'Content-Type': 'application/json'}});
    };
  }, FAULTS_KEY);
}

/** Replaces the active faults. They live in the tab's sessionStorage, so they survive reloads. Pass [] to clear. */
export async function setFaults(page: Page, faults: Fault[]) {
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [FAULTS_KEY, JSON.stringify(faults)] as const);
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
