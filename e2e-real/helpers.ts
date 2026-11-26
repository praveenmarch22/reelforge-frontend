// Helpers for browser tests against the real backend (see playwright.real.config.ts).
// Every test signs up its own creator, so tests never share data.

import {execFileSync} from 'node:child_process';
import {expect, type Locator, type Page, type Route} from '@playwright/test';
import type {CreditsInfo, Estimate, Project, User, Voice} from '../src/api/types';

const MAILPIT = process.env.REAL_MAILPIT_URL ?? 'http://127.0.0.1:8225';
const COMPOSE_PROJECT = process.env.REAL_COMPOSE_PROJECT ?? 'rff5';
const API = '/api/v1';

/** Words that make the backend's mock language model fail (backend providers/llm.py, MockLLM). */
export const MOCK_FAIL = '[fail]';

/** Calls the API from the page's browser context, so the session cookies are the page's own. */
export async function call<T = any>(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'rf_csrf')?.value ?? '';
  const res = await page.request.fetch(API + path, {
    method,
    headers: method === 'GET' ? {} : {'X-CSRF-Token': decodeURIComponent(csrf)},
    data: body,
  });
  const text = await res.text();
  return {status: res.status(), body: (text ? JSON.parse(text) : null) as T};
}

async function verificationToken(email: string): Promise<string> {
  let id = '';
  await expect
    .poll(async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      const found = (await res.json()) as {messages: {ID: string}[]};
      id = found.messages[0]?.ID ?? '';
      return id;
    }, {message: `verification email for ${email}`})
    .not.toBe('');
  const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {Text: string};
  const token = message.Text.match(/token=([\w-]+)/)?.[1];
  if (!token) throw new Error(`No verification link in the email to ${email}`);
  return token;
}

let counter = 0;

/**
 * Signs up a new creator through the API, verifies the email with the link from Mailpit, and
 * finishes onboarding, so the browser is signed in and the app opens normally.
 */
export async function newCreator(page: Page, opts: {niche?: string} = {}): Promise<User> {
  counter += 1;
  const email = `f5-${Date.now()}-${counter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const signup = await call(page, 'POST', '/auth/signup', {email, password: 'F5-test-pass-123', name: 'Mira Test'});
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  const verify = await call(page, 'POST', '/auth/verify-email', {token: await verificationToken(email)});
  expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  const me = await call<{user: User}>(page, 'PATCH', '/me', {niche: opts.niche ?? 'Fitness', onboardingCompleted: true});
  expect(me.status, JSON.stringify(me.body)).toBe(200);
  return me.body.user;
}

/** Sets a test creator's credit balance directly in the test stack's database. */
export function setBalance(userId: string, balance: number) {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error(`not a user id: ${userId}`);
  execFileSync(
    'docker',
    [
      'compose', '-p', COMPOSE_PROJECT, 'exec', '-T', 'postgres', 'sh', '-c',
      `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update credit_accounts set balance = ${Number(balance)} where user_id = '${userId}'"`,
    ],
    {encoding: 'utf8'},
  );
}

export const credits = async (page: Page) => (await call<CreditsInfo>(page, 'GET', '/credits')).body;
export const voices = async (page: Page) => (await call<{items: Voice[]}>(page, 'GET', '/voices')).body.items;
export const getProject = async (page: Page, id: string) =>
  (await call<{project: Project}>(page, 'GET', `/projects/${id}`)).body.project;
export const getEstimate = async (page: Page, id: string) =>
  (await call<Estimate>(page, 'GET', `/projects/${id}/estimate`)).body;

/** Creates a project with B3 and waits until its script is written (the mock writes 4 scenes). */
export async function draftProject(page: Page, topic = 'Morning walks', extra: Record<string, unknown> = {}): Promise<Project> {
  const res = await call<{project: Project}>(page, 'POST', '/projects', {
    topic, tone: 'educational', mode: 'faceless', targetSeconds: 30, ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  const id = res.body.project.id;
  await expect.poll(async () => (await getProject(page, id)).status, {message: 'script written'}).toBe('draft');
  return getProject(page, id);
}

/** Narrations in screen order, as the creator sees them. */
export async function narrations(page: Page): Promise<string[]> {
  const boxes = page.getByRole('textbox', {name: /^Scene \d+ narration$/});
  return boxes.evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
}

/** Server-side narrations in position order. */
export async function savedNarrations(page: Page, id: string): Promise<string[]> {
  const p = await getProject(page, id);
  return [...p.scenes].sort((a, b) => a.position - b.position).map((s) => s.narration);
}

export const sceneCard = (page: Page, n: number) => page.getByRole('article', {name: `Scene ${n}`, exact: true});
export const narration = (page: Page, n: number) => page.getByRole('textbox', {name: `Scene ${n} narration`, exact: true});
export const summary = (page: Page) => page.getByRole('complementary', {name: 'Summary'});

/** Resolves when the next answer to a request matching `method` and `pattern` has arrived. */
export const answered = (page: Page, method: string, pattern: RegExp) =>
  page.waitForResponse((r) => r.request().method() === method && pattern.test(new URL(r.url()).pathname));

/**
 * Holds the browser's GET /projects/:id requests until `release()` is called. The script is written
 * in under a second by the mock model, so this keeps the "Writing your script…" state on screen long
 * enough to check it; the answers that follow are the backend's own.
 */
export async function holdProjectFetches(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const handler = async (route: Route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  };
  await page.route(/\/api\/v1\/projects\/[0-9a-f-]{36}$/, handler);
  return {
    release: async () => {
      release();
      await page.unroute(/\/api\/v1\/projects\/[0-9a-f-]{36}$/, handler);
    },
  };
}

export async function chooseOption(select: Locator, label: RegExp) {
  const value = await select.locator('option').filter({hasText: label}).first().getAttribute('value');
  if (value === null) throw new Error(`no option ${label}`);
  await select.selectOption(value);
}
