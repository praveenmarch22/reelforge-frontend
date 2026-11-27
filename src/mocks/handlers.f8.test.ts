import {setupServer} from 'msw/node';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {DEMO_EMAIL, DEMO_PASSWORD, finishYouTubeConnect} from './db';
import {handlers} from './handlers';

// The mock endpoints added for F8, checked against API_DESIGN.md (A11, A12, H1, H2) and
// PUBLISHING_YOUTUBE.md (F3). Simulated latency is not part of the contract.
vi.mock('msw', async (importOriginal) => ({
  ...(await importOriginal<typeof import('msw')>()),
  delay: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({onUnhandledRequest: 'error'}));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
// src/test/setup.ts clears localStorage after each test: every test starts from the seed data, signed out.

type Result = {status: number; body: any}; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown): Promise<Result> {
  const res = await fetch(`${location.origin}/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {status: res.status, body: res.status === 204 ? null : await res.json()};
}
const login = (password = DEMO_PASSWORD) => call('POST', '/auth/login', {email: DEMO_EMAIL, password});
const NEW_PASSWORD = 'A-new-passphrase-9';

function expectError(res: Result, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(['error']);
  expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
}

describe('F8 mock endpoints need a signed-in user', () => {
  it.each([
    ['GET', '/credits/ledger', undefined],
    ['POST', '/me/password', {currentPassword: DEMO_PASSWORD, newPassword: NEW_PASSWORD}],
    ['DELETE', '/me', {password: DEMO_PASSWORD}],
    ['DELETE', '/connections/youtube', undefined],
  ])('%s %s answers 401 not_authenticated when signed out', async (method, path, body) => {
    expectError(await call(method, path, body), 401, 'not_authenticated');
  });
});

describe('H2 GET /credits/ledger', () => {
  it('answers a page of entries with the documented fields and a cursor', async () => {
    await login();

    const res = await call('GET', '/credits/ledger?limit=20');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'nextCursor']);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['amount', 'createdAt', 'id', 'jobId', 'kind', 'note', 'projectId']);
      expect(['grant', 'reserve', 'refund', 'adjust']).toContain(item.kind);
      expect(Number.isInteger(item.amount)).toBe(true);
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    }
  });

  it('shows the monthly grant, which matches the allowance in H1', async () => {
    await login();

    const credits = (await call('GET', '/credits')).body;
    const grant = (await call('GET', '/credits/ledger')).body.items.find((i: {kind: string}) => i.kind === 'grant');

    expect(grant.amount).toBe(credits.monthlyAllowance);
  });
});

describe('H1 GET /credits (costs added for F8)', () => {
  it('prices every action in the API design, free ones as 0', async () => {
    await login();

    const {costs} = (await call('GET', '/credits')).body;

    expect(costs).toMatchObject({
      script: 1, voicePer30s: 2, voiceSceneShort: 1, aiImage: 1, aiVideoClip: 10, render: 2, transcribe: 1, ideas: 0, hooks: 0, rewrite: 1,
    });
  });
});

describe('A11 POST /me/password', () => {
  it('changes the password: 204, the session stays, and only the new password logs in', async () => {
    await login();

    const res = await call('POST', '/me/password', {currentPassword: DEMO_PASSWORD, newPassword: NEW_PASSWORD});

    expect(res.status).toBe(204);
    expect((await call('GET', '/me')).status).toBe(200);
    await call('POST', '/auth/logout');
    expectError(await login(DEMO_PASSWORD), 401, 'invalid_credentials');
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('a wrong current password is 401 invalid_credentials, and the session is still valid', async () => {
    await login();

    const res = await call('POST', '/me/password', {currentPassword: 'not-the-password', newPassword: NEW_PASSWORD});

    expectError(res, 401, 'invalid_credentials');
    expect((await call('GET', '/me')).status).toBe(200);
    await call('POST', '/auth/logout');
    expect((await login(DEMO_PASSWORD)).status).toBe(200); // nothing changed
  });

  it.each([
    ['short', 'x1'],
    ['missing', undefined],
  ])('a %s new password is 400 with the field named, and nothing changes', async (_what, newPassword) => {
    await login();

    const res = await call('POST', '/me/password', {currentPassword: DEMO_PASSWORD, newPassword});

    expectError(res, 400, 'validation_error');
    expect(typeof res.body.error.details.fields.newPassword).toBe('string');
    await call('POST', '/auth/logout');
    expect((await login(DEMO_PASSWORD)).status).toBe(200);
  });
});

describe('A12 DELETE /me', () => {
  it('deletes the account: 204, the session ends, and the old login no longer works', async () => {
    await login();

    const res = await call('DELETE', '/me', {password: DEMO_PASSWORD});

    expect(res.status).toBe(204);
    expectError(await call('GET', '/me'), 401, 'not_authenticated');
    expectError(await login(), 401, 'invalid_credentials');
  });

  it('the address is free for a new sign-up straight away, as a brand-new account', async () => {
    await login();
    await call('DELETE', '/me', {password: DEMO_PASSWORD});

    const res = await call('POST', '/auth/signup', {name: 'Asha Again', email: DEMO_EMAIL, password: NEW_PASSWORD});

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(DEMO_EMAIL);
    expect((await call('GET', '/projects')).body.items).toEqual([]);
  });

  it.each([
    ['wrong', 'not-the-password'],
    ['missing', undefined],
  ])('a %s password is 401 invalid_credentials and the account stays, signed in', async (_what, password) => {
    await login();

    const res = await call('DELETE', '/me', password === undefined ? {} : {password});

    expectError(res, 401, 'invalid_credentials');
    expect((await call('GET', '/me')).body.user.email).toBe(DEMO_EMAIL);
  });
});

describe('F3 DELETE /connections/:platform', () => {
  async function connectYouTube() {
    const res = await call('GET', `/connections/youtube/connect?returnTo=${encodeURIComponent('/app/settings?tab=youtube')}`);
    const state = new URL(res.body.authorizeUrl, location.origin).searchParams.get('state')!;
    return finishYouTubeConnect(state, 'allow', 'Asha Shorts');
  }

  it('disconnects YouTube: 204 and /me shows no channel', async () => {
    await login();
    expect(await connectYouTube()).toBe('/app/settings?tab=youtube&connected=youtube');
    expect((await call('GET', '/me')).body.user.connections.youtube).toMatchObject({status: 'connected', name: 'Asha Shorts'});

    const res = await call('DELETE', '/connections/youtube');

    expect(res.status).toBe(204);
    expect((await call('GET', '/me')).body.user.connections.youtube).toBeNull();
  });

  it('is 204 again when nothing is connected', async () => {
    await login();

    expect((await call('DELETE', '/connections/youtube')).status).toBe(204);
  });

  it('Instagram is not available: 404 not_available', async () => {
    await login();

    expectError(await call('DELETE', '/connections/instagram'), 404, 'not_available');
  });
});
