import {setupServer} from 'msw/node';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {DEMO_EMAIL, DEMO_PASSWORD, finishInstagramConnect, finishYouTubeConnect, readDevLink, type YouTubeOutcome} from './db';
import {handlers} from './handlers';

// The mock API is the contract the screens are built against, so it is checked against
// API_DESIGN.md (endpoints A1-A10, B2, B6, D3, F1, H1). Simulated latency is not part of the contract.
vi.mock('msw', async (importOriginal) => ({
  ...(await importOriginal<typeof import('msw')>()),
  delay: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({onUnhandledRequest: 'error'}));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
// src/test/setup.ts clears localStorage after each test, so every test starts from the seed data, signed out.

type Result = {status: number; body: any}; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown): Promise<Result> {
  const res = await fetch(`${location.origin}/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {status: res.status, body: res.status === 204 ? null : await res.json()};
}
const get = (path: string) => call('GET', path);
const post = (path: string, body?: unknown) => call('POST', path, body);

const NEW_USER = {name: 'Asha Rao', email: 'asha@example.com', password: 'Asha-test-pass-1'};
const loginDemo = () => post('/auth/login', {email: DEMO_EMAIL, password: DEMO_PASSWORD});
const signUp = (over: Partial<typeof NEW_USER> = {}) => post('/auth/signup', {...NEW_USER, ...over});

/** The token from the link the mock "emailed" last. */
function lastToken(kind: 'verify_email' | 'reset_password'): string {
  const link = readDevLink(kind);
  if (!link) throw new Error(`No ${kind} link was issued`);
  return new URL(link, location.origin).searchParams.get('token')!;
}

const USER_KEYS = [
  'connections', 'credits', 'defaults', 'email', 'emailVerified', 'id', 'instagram', 'isAdmin', 'name', 'niche',
  'onboardingCompleted',
];
const SUMMARY_KEYS = ['durationSeconds', 'id', 'mode', 'progress', 'status', 'targetSeconds', 'thumbnailUrl', 'title', 'updatedAt'];

describe('A1 POST /auth/signup', () => {
  it('creates an unverified, signed-in account with the monthly credits', async () => {
    const res = await signUp();

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.user).sort()).toEqual(USER_KEYS);
    expect(res.body.user).toMatchObject({
      email: NEW_USER.email,
      name: NEW_USER.name,
      emailVerified: false,
      isAdmin: false,
      onboardingCompleted: false,
      credits: {balance: 100, monthlyAllowance: 100},
      instagram: {connected: false, username: null, status: null, expiresAt: null},
    });
    expect((await get('/me')).body.user.id).toBe(res.body.user.id);
  });

  it('reports every invalid field in details.fields', async () => {
    const res = await post('/auth/signup', {name: ' ', email: 'not-an-email', password: 'short'});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual(['email', 'name', 'password']);
    expect((await get('/me')).status).toBe(401);
  });

  it.each(['password', '12345678', 'a'.repeat(129)])('rejects the password "%s"', async (password) => {
    const res = await signUp({password});

    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty('password');
  });

  it('rejects a name longer than 80 characters', async () => {
    const res = await signUp({name: 'a'.repeat(81)});

    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty('name');
  });

  it('accepts a name of exactly 80 characters', async () => {
    expect((await signUp({name: 'a'.repeat(80)})).status).toBe(201);
  });

  it('answers 409 email_taken for an email that is already registered, whatever its case', async () => {
    const res = await signUp({email: DEMO_EMAIL.toUpperCase()});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
    expect((await get('/me')).status).toBe(401);
  });
});

describe('A2 POST /auth/verify-email', () => {
  it('verifies the account once; the same token then answers 410 token_invalid', async () => {
    await signUp();
    const token = lastToken('verify_email');

    const first = await post('/auth/verify-email', {token});
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({email: NEW_USER.email, emailVerified: true});
    expect((await get('/me')).body.user.emailVerified).toBe(true);

    const second = await post('/auth/verify-email', {token});
    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe('token_invalid');
  });

  it('answers 410 token_invalid for an unknown token', async () => {
    const res = await post('/auth/verify-email', {token: 'nope'});

    expect([res.status, res.body.error.code]).toEqual([410, 'token_invalid']);
  });

  it('does not accept a password-reset token', async () => {
    await post('/auth/forgot-password', {email: DEMO_EMAIL});

    const res = await post('/auth/verify-email', {token: lastToken('reset_password')});

    expect(res.status).toBe(410);
  });
});

describe('A3 POST /auth/resend-verification', () => {
  it('needs a signed-in user', async () => {
    const res = await post('/auth/resend-verification');

    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
  });

  it('sends a new working link to an unverified user', async () => {
    await signUp();
    const firstToken = lastToken('verify_email');

    expect((await post('/auth/resend-verification')).status).toBe(204);

    const newToken = lastToken('verify_email');
    expect(newToken).not.toBe(firstToken);
    expect((await post('/auth/verify-email', {token: newToken})).status).toBe(200);
  });

  it('answers 409 when the email is already verified', async () => {
    await loginDemo();

    expect((await post('/auth/resend-verification')).status).toBe(409);
  });
});

describe('A4 POST /auth/login', () => {
  it('signs in with the right email and password', async () => {
    const res = await loginDemo();

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({email: DEMO_EMAIL, emailVerified: true});
    expect((await get('/me')).status).toBe(200);
  });

  it('ignores the case of the email', async () => {
    const res = await post('/auth/login', {email: DEMO_EMAIL.toUpperCase(), password: DEMO_PASSWORD});

    expect(res.status).toBe(200);
  });

  it('answers 401 invalid_credentials with the same message for a wrong password and an unknown email', async () => {
    const wrongPassword = await post('/auth/login', {email: DEMO_EMAIL, password: 'wrong-password'});
    const unknownEmail = await post('/auth/login', {email: 'nobody@example.com', password: DEMO_PASSWORD});

    expect([wrongPassword.status, wrongPassword.body.error.code]).toEqual([401, 'invalid_credentials']);
    expect(unknownEmail).toEqual(wrongPassword);
    expect((await get('/me')).status).toBe(401);
  });
});

describe('A5 POST /auth/refresh and A6 POST /auth/logout', () => {
  it('refresh answers 401 not_authenticated without a session', async () => {
    const res = await post('/auth/refresh');

    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
  });

  it('refresh returns the user while signed in', async () => {
    await loginDemo();

    const res = await post('/auth/refresh');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(DEMO_EMAIL);
  });

  it('logout answers 204 and ends the session', async () => {
    await loginDemo();

    expect((await post('/auth/logout')).status).toBe(204);
    expect((await get('/me')).status).toBe(401);
    expect((await post('/auth/refresh')).status).toBe(401);
  });
});

describe('A7 POST /auth/forgot-password and A8 POST /auth/reset-password', () => {
  it('answers 204 whether or not the email exists, and only issues a link for a real account', async () => {
    expect((await post('/auth/forgot-password', {email: 'nobody@example.com'})).status).toBe(204);
    expect(readDevLink('reset_password')).toBeNull();

    expect((await post('/auth/forgot-password', {email: DEMO_EMAIL})).status).toBe(204);
    expect(readDevLink('reset_password')).toMatch(/^\/reset\?token=/);
  });

  it('sets the new password, revokes sessions, and the token works only once', async () => {
    await loginDemo();
    await post('/auth/forgot-password', {email: DEMO_EMAIL});
    const token = lastToken('reset_password');
    const newPassword = 'a-brand-new-pass-9';

    expect((await post('/auth/reset-password', {token, password: newPassword})).status).toBe(204);

    expect((await get('/me')).status, 'all sessions are revoked').toBe(401);
    expect((await loginDemo()).status, 'old password').toBe(401);
    expect((await post('/auth/login', {email: DEMO_EMAIL, password: newPassword})).status, 'new password').toBe(200);

    const reuse = await post('/auth/reset-password', {token, password: 'another-pass-10'});
    expect([reuse.status, reuse.body.error.code]).toEqual([410, 'token_invalid']);
  });

  it('answers 400 for a password that is too short and leaves the link usable', async () => {
    await post('/auth/forgot-password', {email: DEMO_EMAIL});
    const token = lastToken('reset_password');

    const bad = await post('/auth/reset-password', {token, password: 'short'});
    expect([bad.status, bad.body.error.code]).toEqual([400, 'validation_error']);
    expect(bad.body.error.details.fields).toHaveProperty('password');

    expect((await post('/auth/reset-password', {token, password: 'long-enough-pass-1'})).status).toBe(204);
  });

  it('answers 410 token_invalid for an unknown token and for a verification token', async () => {
    await signUp();

    for (const token of ['nope', lastToken('verify_email')]) {
      const res = await post('/auth/reset-password', {token, password: 'long-enough-pass-1'});
      expect([res.status, res.body.error.code]).toEqual([410, 'token_invalid']);
    }
  });
});

describe('A9 GET /me and A10 PATCH /me', () => {
  it('GET /me answers 401 not_authenticated when signed out', async () => {
    const res = await get('/me');

    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
    expect(typeof res.body.error.message).toBe('string');
  });

  it('GET /me returns the User object, without the password', async () => {
    await loginDemo();

    const {body} = await get('/me');

    expect(Object.keys(body.user).sort()).toEqual(USER_KEYS);
    expect(Object.keys(body.user.defaults).sort()).toEqual(['captionStyle', 'mode', 'voiceId']);
    expect(Object.keys(body.user.credits).sort()).toEqual(['balance', 'monthlyAllowance', 'resetsAt']);
    expect(Object.keys(body.user.instagram).sort()).toEqual(['connected', 'expiresAt', 'status', 'username']);
    expect(JSON.stringify(body)).not.toContain(DEMO_PASSWORD);
  });

  it('PATCH /me updates only the fields that were sent', async () => {
    await loginDemo();
    const before = (await get('/me')).body.user;

    const res = await call('PATCH', '/me', {niche: 'Fitness', defaults: {mode: 'full_ai'}});

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({...before, niche: 'Fitness', defaults: {...before.defaults, mode: 'full_ai'}});
    expect((await get('/me')).body.user).toEqual(res.body.user);
  });

  it('PATCH /me can complete onboarding but not undo it', async () => {
    await signUp();

    expect((await call('PATCH', '/me', {onboardingCompleted: true})).body.user.onboardingCompleted).toBe(true);
    await call('PATCH', '/me', {onboardingCompleted: false});
    expect((await get('/me')).body.user.onboardingCompleted).toBe(true);
  });

  it('PATCH /me needs a signed-in user', async () => {
    expect((await call('PATCH', '/me', {name: 'X'})).status).toBe(401);
  });
});

describe('B2 GET /projects', () => {
  it('needs a signed-in user', async () => {
    const res = await get('/projects');

    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
  });

  it("lists the user's Reels as ProjectSummary objects, newest first, with counts", async () => {
    await loginDemo();

    const {status, body} = await get('/projects');

    expect(status).toBe(200);
    expect(body.items).toHaveLength(7);
    expect(body.nextCursor).toBeNull();
    expect(body.counts).toEqual({total: 7, posted: 2});
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
    const times = body.items.map((p: {updatedAt: string}) => p.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('has progress only on Reels that are in progress', async () => {
    await loginDemo();

    const {body} = await get('/projects');

    for (const p of body.items) {
      if (['scripting', 'generating', 'rendering', 'posting'].includes(p.status)) {
        expect(p.progress, p.title).toBeGreaterThanOrEqual(0);
        expect(p.progress, p.title).toBeLessThanOrEqual(100);
      } else {
        expect(p.progress, p.title).toBeNull();
      }
    }
  });

  it.each([
    ['posted', ['posted', 'posted']],
    ['draft', ['draft']],
    ['render_failed,post_failed', ['render_failed']],
    ['ready,rendered', ['ready', 'rendered']],
    ['posting', []],
  ])('filters by status=%s, with counts still covering every Reel', async (status, expected) => {
    await loginDemo();

    const {body} = await get(`/projects?status=${status}`);

    expect(body.items.map((p: {status: string}) => p.status).sort()).toEqual(expected);
    expect(body.counts).toEqual({total: 7, posted: 2});
  });

  it('searches titles with q, ignoring case, and combines q with status', async () => {
    await loginDemo();

    const tokyo = await get('/projects?q=TOKYO');
    expect(tokyo.body.items.map((p: {title: string}) => p.title)).toEqual(['Cinematic Tokyo night run']);
    expect(tokyo.body.counts.total).toBe(7);

    expect((await get('/projects?q=tokyo&status=posted')).body.items).toEqual([]);
    expect((await get('/projects?q=no-such-reel')).body.items).toEqual([]);
  });

  it('honours limit, and caps it at 100', async () => {
    await loginDemo();

    expect((await get('/projects?limit=3')).body.items).toHaveLength(3);
    expect((await get('/projects?limit=5000')).body.items).toHaveLength(7);
  });

  it('moves a generating Reel forward on each poll until it is ready', async () => {
    await loginDemo();
    const generating = async () => {
      const {body} = await get('/projects');
      return body.items.find((p: {title: string}) => p.title === 'Hyperfocus in 5 minutes');
    };

    const first = await generating();
    expect(first.status).toBe('generating');
    const second = await generating();
    expect(second.progress).toBeGreaterThan(first.progress);

    let latest = second;
    for (let polls = 0; latest.status === 'generating' && polls < 100; polls++) latest = await generating();

    expect(latest.status).toBe('ready');
    expect(latest.progress).toBeNull();
    expect(latest.durationSeconds).toBeGreaterThan(0);
  });

  it('gives a new account an empty list', async () => {
    await signUp();

    expect((await get('/projects')).body).toEqual({items: [], nextCursor: null, counts: {total: 0, posted: 0}});
  });
});

describe('B6 DELETE /projects/:id', () => {
  const firstProjectId = async () => (await get('/projects')).body.items[0].id as string;

  it('answers 204 and the Reel is gone from the list and the counts', async () => {
    await loginDemo();
    const id = await firstProjectId();

    expect((await call('DELETE', `/projects/${id}`)).status).toBe(204);

    const {body} = await get('/projects');
    expect(body.items.map((p: {id: string}) => p.id)).not.toContain(id);
    expect(body.counts.total).toBe(6);
  });

  it('answers 404 not_found for an unknown id and for a Reel that was already deleted', async () => {
    await loginDemo();
    const id = await firstProjectId();
    await call('DELETE', `/projects/${id}`);

    for (const target of [id, '00000000-0000-4000-8000-00000000dead']) {
      const res = await call('DELETE', `/projects/${target}`);
      expect([res.status, res.body.error.code]).toEqual([404, 'not_found']);
    }
  });

  it("answers 404, not 403, for another user's Reel and leaves it in place", async () => {
    await loginDemo();
    const id = await firstProjectId();
    await post('/auth/logout');
    await signUp();

    const res = await call('DELETE', `/projects/${id}`);
    expect([res.status, res.body.error.code]).toEqual([404, 'not_found']);

    await post('/auth/logout');
    await loginDemo();
    expect((await get('/projects')).body.counts.total).toBe(7);
  });

  it('needs a signed-in user', async () => {
    expect((await call('DELETE', '/projects/anything')).status).toBe(401);
  });
});

describe('endpoints that are not mocked yet', () => {
  it.each([
    ['GET', '/credits/ledger'],
    ['POST', '/ideas'],
    ['GET', '/projects/10000000-0000-4000-8000-000000000001'],
    ['POST', '/me/password'],
  ])('%s %s answers 501 not_mocked in the error format, not a page of HTML', async (method, path) => {
    const res = await call(method, path, method === 'GET' ? undefined : {});

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('not_mocked');
    expect(res.body.error.message).toContain(`${method} /api/v1${path}`);
  });
});

describe('D3 GET /voices', () => {
  it('needs a signed-in user', async () => {
    const res = await get('/voices');

    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
  });

  it('returns the curated voices in the documented shape', async () => {
    await loginDemo();

    const {status, body} = await get('/voices');

    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['items']);
    expect(body.items).toHaveLength(6);
    for (const voice of body.items) {
      expect(Object.keys(voice).sort()).toEqual(['accent', 'gender', 'id', 'name', 'previewUrl', 'provider', 'style']);
      expect(voice.provider).toBe('elevenlabs');
      for (const key of ['id', 'name', 'gender', 'accent', 'style', 'previewUrl']) expect(voice[key], key).toEqual(expect.any(String));
      expect(voice.previewUrl).not.toBe('');
    }
    expect(new Set(body.items.map((v: {id: string}) => v.id)).size).toBe(6);
  });

  it('is available to an unverified user too (the endpoint is "User", not "Verified")', async () => {
    await signUp();

    expect((await get('/voices')).status).toBe(200);
  });
});

describe('F1 GET /instagram/connect', () => {
  const verifiedNewUser = async () => {
    await signUp();
    await post('/auth/verify-email', {token: lastToken('verify_email')});
  };
  const stateOf = (authorizeUrl: string) => new URL(authorizeUrl, location.origin).searchParams.get('state')!;
  const connect = (returnTo?: string) =>
    get(`/instagram/connect${returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`}`);

  it('needs a signed-in user', async () => {
    const res = await connect('/onboarding?step=3');

    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
  });

  it('answers 403 email_not_verified for an unverified user', async () => {
    await signUp();

    const res = await connect('/onboarding?step=3');

    expect([res.status, res.body.error.code]).toEqual([403, 'email_not_verified']);
    expect(typeof res.body.error.message).toBe('string');
  });

  it('gives a verified user an authorizeUrl that carries a state', async () => {
    await verifiedNewUser();

    const res = await connect('/onboarding?step=3');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['authorizeUrl']);
    expect(stateOf(res.body.authorizeUrl)).toMatch(/\S{16,}/);
  });

  it('issues a different state for every attempt', async () => {
    await verifiedNewUser();

    const first = stateOf((await connect('/onboarding?step=3')).body.authorizeUrl);
    const second = stateOf((await connect('/onboarding?step=3')).body.authorizeUrl);

    expect(second).not.toBe(first);
  });

  it('the state carries returnTo: finishing the connection returns to that page and /me shows the account', async () => {
    await verifiedNewUser();
    const {body} = await connect('/onboarding?step=3');

    const destination = finishInstagramConnect(stateOf(body.authorizeUrl), 'creator', 'asha_creates');

    expect(destination).toBe('/onboarding?step=3&instagram=connected');
    expect((await get('/me')).body.user.instagram).toMatchObject({connected: true, username: 'asha_creates', status: 'connected'});
  });

  it('returns to /app/settings when returnTo is left out', async () => {
    await verifiedNewUser();
    const {body} = await connect();

    expect(finishInstagramConnect(stateOf(body.authorizeUrl), 'denied', 'asha_creates')).toBe(
      '/app/settings?instagram=error&reason=denied',
    );
  });

  it.each([
    '//evil.example',
    'https://evil.example/onboarding',
    'onboarding',
    '',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    `/app/projects?q=${'x'.repeat(300)}`,
  ])(
    'ignores the returnTo %j, which is not an acceptable path inside the app, and uses /app/settings',
    async (returnTo) => {
      await verifiedNewUser();
      const {status, body} = await connect(returnTo);

      expect(status).toBe(200);
      expect(finishInstagramConnect(stateOf(body.authorizeUrl), 'creator', 'asha_creates')).toBe(
        '/app/settings?instagram=connected',
      );
    },
  );
});

describe('F1 and F2 together: the rules of the connect round trip, through the API', () => {
  const stateOf = (authorizeUrl: string) => new URL(authorizeUrl, location.origin).searchParams.get('state')!;
  const startAsNewUser = async (returnTo: string) => {
    await signUp();
    await post('/auth/verify-email', {token: lastToken('verify_email')});
    const {body} = await get(`/instagram/connect?returnTo=${encodeURIComponent(returnTo)}`);
    return stateOf(body.authorizeUrl);
  };
  const NOT_CONNECTED = {connected: false, username: null, status: null, expiresAt: null};
  const FAILED = '/app/settings?instagram=error&reason=failed';

  it('a returnTo that already carries a result, and a fragment, comes back with one result and no fragment', async () => {
    const state = await startAsNewUser('/onboarding?step=3&instagram=connected&reason=denied#top');

    expect(finishInstagramConnect(state, 'personal_account', 'asha_creates')).toBe(
      '/onboarding?step=3&instagram=error&reason=personal_account',
    );
  });

  // F2: "...and that the signed-in user is the user inside `state`."
  it("another user who logs in and opens the first user's approval link connects neither account", async () => {
    const state = await startAsNewUser('/onboarding?step=3');
    await post('/auth/logout');
    await loginDemo();
    const demoBefore = (await get('/me')).body.user.instagram;

    expect(finishInstagramConnect(state, 'creator', 'someone_else')).toBe(FAILED);

    expect((await get('/me')).body.user.instagram).toEqual(demoBefore);
    await post('/auth/logout');
    await post('/auth/login', {email: NEW_USER.email, password: NEW_USER.password});
    expect((await get('/me')).body.user.instagram).toEqual(NOT_CONNECTED);
  });

  it('after logging out, the approval link connects nothing', async () => {
    const state = await startAsNewUser('/onboarding?step=3');
    await post('/auth/logout');

    expect(finishInstagramConnect(state, 'creator', 'asha_creates')).toBe(FAILED);

    await post('/auth/login', {email: NEW_USER.email, password: NEW_USER.password});
    expect((await get('/me')).body.user.instagram).toEqual(NOT_CONNECTED);
  });
});

describe('H1 GET /credits', () => {
  it('returns the balance, allowance, reset date and the cost table', async () => {
    await loginDemo();

    const {status, body} = await get('/credits');

    expect(status).toBe(200);
    expect(body).toMatchObject({balance: 86, monthlyAllowance: 100});
    expect(new Date(body.resetsAt).getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(body.costs).sort()).toEqual(['aiImage', 'aiVideoClip', 'render', 'script', 'transcribe', 'voicePer30s']);
  });

  it('needs a signed-in user', async () => {
    expect((await get('/credits')).status).toBe(401);
  });
});

// ---------------------------------------------------------------- F7: YouTube connect (B6 F1)

describe('F1 GET /connections/:platform/connect (YouTube, F7 mock)', () => {
  const connect = (platform: string, returnTo?: string) =>
    get(`/connections/${platform}/connect${returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`}`);
  const verifiedNewUser = async () => {
    await signUp();
    await post('/auth/verify-email', {token: lastToken('verify_email')});
  };

  it('needs a signed-in user', async () => {
    const res = await connect('youtube', '/onboarding?step=3');
    expect([res.status, res.body.error.code]).toEqual([401, 'not_authenticated']);
  });

  it('answers 403 email_not_verified for an unverified user', async () => {
    await signUp();
    const res = await connect('youtube', '/onboarding?step=3');
    expect([res.status, res.body.error.code]).toEqual([403, 'email_not_verified']);
  });

  it('answers 404 not_available for Instagram (until B6b)', async () => {
    await loginDemo();
    const res = await connect('instagram', '/onboarding?step=3');
    expect([res.status, res.body.error.code]).toEqual([404, 'not_available']);
  });

  it('a new user has no YouTube connection until connecting', async () => {
    await verifiedNewUser();
    expect((await get('/me')).body.user.connections).toEqual({youtube: null, instagram: null});
  });

  /** F1, then the stand-in Google page's answer (db.finishYouTubeConnect, as F2). */
  const connectAndAnswer = async (returnTo: string | undefined, outcome: YouTubeOutcome = 'allow') => {
    const res = await connect('youtube', returnTo);
    const state = new URL(res.body.authorizeUrl, 'http://app.invalid').searchParams.get('state')!;
    return {res, back: finishYouTubeConnect(state, outcome, 'Asha Shorts')};
  };

  it('answers only {authorizeUrl}, the stand-in Google page; allowing comes back with connected=youtube and /me shows the channel', async () => {
    await verifiedNewUser();
    const {res, back} = await connectAndAnswer('/app/p/abc/publish');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['authorizeUrl']);
    expect(res.body.authorizeUrl).toMatch(/^\/mock\/youtube\?state=\w+$/);
    expect(back).toBe('/app/p/abc/publish?connected=youtube');
    const {youtube, instagram} = (await get('/me')).body.user.connections;
    expect(instagram).toBeNull();
    expect(Object.keys(youtube).sort()).toEqual(['connectedAt', 'name', 'pictureUrl', 'status']);
    expect(youtube).toMatchObject({status: 'connected', name: 'Asha Shorts', pictureUrl: null});
    expect(Number.isNaN(Date.parse(youtube.connectedAt))).toBe(false);
  });

  it('each refusal comes back with its reason and stores nothing', async () => {
    await verifiedNewUser();
    for (const outcome of ['denied', 'missing_permission', 'no_channel'] as const) {
      const {back} = await connectAndAnswer('/onboarding?step=3', outcome);
      expect(back).toBe(`/onboarding?step=3&connection_error=youtube&reason=${outcome}`);
    }
    expect((await get('/me')).body.user.connections.youtube).toBeNull();
  });

  it('a state is used once', async () => {
    await verifiedNewUser();
    const res = await connect('youtube', '/onboarding?step=3');
    const state = new URL(res.body.authorizeUrl, 'http://app.invalid').searchParams.get('state')!;
    expect(finishYouTubeConnect(state, 'allow', 'A')).toBe('/onboarding?step=3&connected=youtube');
    expect(finishYouTubeConnect(state, 'allow', 'A')).toBe('/app/settings?connection_error=youtube&reason=failed');
  });

  it('keeps the query string of returnTo', async () => {
    await verifiedNewUser();
    expect((await connectAndAnswer('/onboarding?step=3')).back).toBe('/onboarding?step=3&connected=youtube');
  });

  it('an unsafe or missing returnTo goes to the settings page', async () => {
    await verifiedNewUser();
    expect((await connectAndAnswer('https://evil.example/x')).back).toBe('/app/settings?connected=youtube');
    expect((await connectAndAnswer('//evil.example')).back).toBe('/app/settings?connected=youtube');
    expect((await connectAndAnswer(undefined)).back).toBe('/app/settings?connected=youtube');
  });

  it('drops an earlier result left in returnTo, as the real API does (connected, connection_error, platform, reason)', async () => {
    await verifiedNewUser();
    const {back} = await connectAndAnswer('/onboarding?step=3&connection_error=youtube&reason=denied&platform=youtube');
    expect(back).toBe('/onboarding?step=3&connected=youtube');
  });

  it("connecting one user leaves another user's connection alone", async () => {
    await loginDemo();
    const before = (await get('/me')).body.user.connections.youtube;
    await post('/auth/logout');
    await verifiedNewUser();
    await connectAndAnswer('/app');
    await post('/auth/logout');
    await loginDemo();
    expect((await get('/me')).body.user.connections.youtube).toEqual(before);
  });
});
