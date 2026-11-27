// Mock implementations of the endpoints in docs/API_DESIGN.md (reelforge-backend repository).
// Each handler is labelled with its endpoint number (A1, B2...) from that document.

import {delay, http, HttpResponse} from 'msw';
import {API_URL} from '@/lib/env';
import type {ProjectStatus} from '@/api/types';
import {
  createUser,
  issueToken,
  listVoices,
  loadDb,
  safeReturnTo,
  saveDb,
  startInstagramConnect,
  toUser,
  type Db,
  type DbUser,
} from './db';

const url = (path: string) => `${API_URL}${path}`;
const LATENCY_MS = 350;

const fail = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  HttpResponse.json({error: {code, message, details}}, {status});

const noContent = () => new HttpResponse(null, {status: 204});

const currentUser = (db: Db): DbUser | undefined => db.users.find((u) => u.id === db.sessionUserId);

const unauthenticated = () => fail(401, 'not_authenticated', 'Please log in to continue.');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  if (['password', '12345678', 'qwertyui'].includes(password.toLowerCase())) return 'That password is too common.';
  return null;
}

export const handlers = [
  // A1
  http.post(url('/auth/signup'), async ({request}) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as {name?: string; email?: string; password?: string};
    const fields: Record<string, string> = {};
    if (!body.name?.trim()) fields.name = 'Tell us your name.';
    else if (body.name.trim().length > 80) fields.name = 'Keep it under 80 characters.';
    if (!body.email || !EMAIL.test(body.email)) fields.email = 'Enter a valid email address.';
    const passwordError = validatePassword(body.password);
    if (passwordError) fields.password = passwordError;
    if (Object.keys(fields).length) return fail(400, 'validation_error', 'Please check the form.', {fields});

    const db = loadDb();
    const email = body.email!.trim().toLowerCase();
    if (db.users.some((u) => u.email === email)) {
      return fail(409, 'email_taken', 'An account with this email already exists.');
    }
    const user = createUser(db, {name: body.name!, email, password: body.password!});
    issueToken(db, user.id, 'verify_email');
    db.sessionUserId = user.id;
    saveDb(db);
    return HttpResponse.json({user: toUser(db, user)}, {status: 201});
  }),

  // A2
  http.post(url('/auth/verify-email'), async ({request}) => {
    await delay(LATENCY_MS);
    const {token} = (await request.json()) as {token?: string};
    const db = loadDb();
    const entry = db.tokens.find((t) => t.token === token && t.kind === 'verify_email' && !t.used);
    const user = entry && db.users.find((u) => u.id === entry.userId);
    if (!entry || !user) return fail(410, 'token_invalid', 'This link has expired or was already used.');
    entry.used = true;
    user.emailVerified = true;
    db.sessionUserId = user.id;
    saveDb(db);
    return HttpResponse.json({user: toUser(db, user)});
  }),

  // A3
  http.post(url('/auth/resend-verification'), async () => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    if (user.emailVerified) return fail(409, 'already_verified', 'Your email is already verified.');
    issueToken(db, user.id, 'verify_email');
    saveDb(db);
    return noContent();
  }),

  // A4
  http.post(url('/auth/login'), async ({request}) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as {email?: string; password?: string};
    const db = loadDb();
    const user = db.users.find((u) => u.email === body.email?.trim().toLowerCase());
    if (!user || user.password !== body.password) {
      return fail(401, 'invalid_credentials', 'Wrong email or password.');
    }
    db.sessionUserId = user.id;
    saveDb(db);
    return HttpResponse.json({user: toUser(db, user)});
  }),

  // A5
  http.post(url('/auth/refresh'), async () => {
    const db = loadDb();
    const user = currentUser(db);
    return user ? HttpResponse.json({user: toUser(db, user)}) : unauthenticated();
  }),

  // A6
  http.post(url('/auth/logout'), async () => {
    await delay(150);
    const db = loadDb();
    db.sessionUserId = null;
    saveDb(db);
    return noContent();
  }),

  // A7: always 204, whether or not the email exists.
  http.post(url('/auth/forgot-password'), async ({request}) => {
    await delay(LATENCY_MS);
    const {email} = (await request.json()) as {email?: string};
    const db = loadDb();
    const user = db.users.find((u) => u.email === email?.trim().toLowerCase());
    if (user) {
      issueToken(db, user.id, 'reset_password');
      saveDb(db);
    }
    return noContent();
  }),

  // A8
  http.post(url('/auth/reset-password'), async ({request}) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as {token?: string; password?: string};
    const db = loadDb();
    const entry = db.tokens.find((t) => t.token === body.token && t.kind === 'reset_password' && !t.used);
    const user = entry && db.users.find((u) => u.id === entry.userId);
    if (!entry || !user) return fail(410, 'token_invalid', 'This link has expired or was already used.');
    const passwordError = validatePassword(body.password);
    if (passwordError) {
      return fail(400, 'validation_error', 'Please check the form.', {fields: {password: passwordError}});
    }
    entry.used = true;
    user.password = body.password!;
    db.sessionUserId = null; // all sessions are revoked
    saveDb(db);
    return noContent();
  }),

  // A9
  http.get(url('/me'), async () => {
    await delay(200);
    const db = loadDb();
    const user = currentUser(db);
    return user ? HttpResponse.json({user: toUser(db, user)}) : unauthenticated();
  }),

  // A10
  http.patch(url('/me'), async ({request}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    const body = (await request.json()) as Partial<Pick<DbUser, 'name' | 'niche' | 'onboardingCompleted'>> & {
      defaults?: Partial<DbUser['defaults']>;
    };
    if (body.name !== undefined) user.name = body.name.trim();
    if (body.niche !== undefined) user.niche = body.niche;
    if (body.defaults) user.defaults = {...user.defaults, ...body.defaults};
    if (body.onboardingCompleted === true) user.onboardingCompleted = true;
    saveDb(db);
    return HttpResponse.json({user: toUser(db, user)});
  }),

  // B2
  http.get(url('/projects'), async ({request}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    const params = new URL(request.url).searchParams;
    const statuses = (params.get('status') ?? '').split(',').filter(Boolean) as ProjectStatus[];
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const limit = Math.min(Number(params.get('limit')) || 20, 100);

    // Simulate background work: each poll moves in-progress Reels forward.
    let changed = false;
    for (const p of db.projects) {
      if (p.userId !== user.id || p.status !== 'generating') continue;
      p.progress = Math.min(100, (p.progress ?? 0) + 3);
      if (p.progress >= 100) {
        p.status = 'ready';
        p.progress = null;
        p.durationSeconds = p.targetSeconds;
        p.updatedAt = new Date().toISOString();
      }
      changed = true;
    }
    if (changed) saveDb(db);

    const mine = db.projects
      .filter((p) => p.userId === user.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const items = mine
      .filter((p) => (statuses.length ? statuses.includes(p.status) : true))
      .filter((p) => (q ? p.title.toLowerCase().includes(q) : true))
      .slice(0, limit)
      .map(({userId: _userId, ...p}) => p);

    return HttpResponse.json({
      items,
      nextCursor: null,
      counts: {total: mine.length, posted: mine.filter((p) => p.status === 'posted').length},
    });
  }),

  // B6
  http.delete(url('/projects/:id'), async ({params}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    const index = db.projects.findIndex((p) => p.id === params.id && p.userId === user.id);
    if (index < 0) return fail(404, 'not_found', "We couldn't find that Reel.");
    db.projects.splice(index, 1);
    saveDb(db);
    return noContent();
  }),

  // H1
  http.get(url('/credits'), async () => {
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    return HttpResponse.json({
      ...toUser(db, user).credits,
      costs: {script: 1, voicePer30s: 2, voiceSceneShort: 1, aiImage: 1, aiVideoClip: 10, render: 2, transcribe: 1, ideas: 0, hooks: 0, rewrite: 1, caption: 0, publish: 0},
    });
  }),

  // H2 (F8): the mock keeps no history, so it shows the grant every account starts with.
  http.get(url('/credits/ledger'), async () => {
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    const allowance = toUser(db, user).credits.monthlyAllowance;
    return HttpResponse.json({
      items: [{id: 'grant-1', amount: allowance, kind: 'grant', note: 'Monthly credits', jobId: null, projectId: null, createdAt: new Date().toISOString()}],
      nextCursor: null,
    });
  }),

  // A11 (F8)
  http.post(url('/me/password'), async ({request}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    const body = (await request.json()) as {currentPassword?: string; newPassword?: string};
    if (body.currentPassword !== user.password) return fail(401, 'invalid_credentials', 'That password is not correct.');
    if (!body.newPassword || body.newPassword.length < 8) {
      return fail(400, 'validation_error', 'Some details need another look.', {fields: {newPassword: 'Use at least 8 characters'}});
    }
    user.password = body.newPassword;
    saveDb(db);
    return noContent();
  }),

  // A12 (F8)
  http.delete(url('/me'), async ({request}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    const body = (await request.json().catch(() => ({}))) as {password?: string};
    if (body.password !== user.password) return fail(401, 'invalid_credentials', 'That password is not correct.');
    db.users = db.users.filter((u) => u.id !== user.id);
    db.projects = db.projects.filter((p) => p.userId !== user.id);
    db.sessionUserId = null;
    saveDb(db);
    return noContent();
  }),

  // F3 (F8)
  http.delete(url('/connections/:platform'), async ({params}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    if (params.platform !== 'youtube') return fail(404, 'not_available', 'Publishing to Instagram is coming soon.');
    if (db.youtube) delete db.youtube[user.id];
    saveDb(db);
    return noContent();
  }),

  // D3
  http.get(url('/voices'), async () => {
    await delay(LATENCY_MS);
    const db = loadDb();
    if (!currentUser(db)) return unauthenticated();
    return HttpResponse.json({items: listVoices()});
  }),

  // F1. The real API answers with Instagram's authorization page; the mock sends the
  // browser to a stand-in page inside the app (src/mocks/MockInstagramPage.tsx).
  http.get(url('/instagram/connect'), async ({request}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    if (!user.emailVerified) {
      return fail(403, 'email_not_verified', 'Verify your email before connecting Instagram.');
    }
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
    const state = startInstagramConnect(db, user.id, returnTo);
    saveDb(db);
    return HttpResponse.json({authorizeUrl: `/mock/instagram?state=${state}`});
  }),

  // F1 for YouTube (B6). The real API answers with Google's sign-in; the mock sends the browser
  // to a stand-in page inside the app.
  http.get(url('/connections/:platform/connect'), async ({request, params}) => {
    await delay(LATENCY_MS);
    const db = loadDb();
    const user = currentUser(db);
    if (!user) return unauthenticated();
    if (params.platform !== 'youtube') return fail(404, 'not_available', 'Publishing to Instagram is coming soon.');
    if (!user.emailVerified) return fail(403, 'email_not_verified', 'Verify your email address to do this.');
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
    // The same one-use state as the real API; the stand-in Google page (src/mocks/MockYouTubePage.tsx)
    // answers as Google would, and db.finishYouTubeConnect does what F2 does.
    const state = startInstagramConnect(db, user.id, returnTo);
    saveDb(db);
    return HttpResponse.json({authorizeUrl: `/mock/youtube?state=${state}`});
  }),

  // Keep last. Any endpoint from the API design that has no mock yet answers with a clear
  // error instead of falling through to the dev server (which would return the app's HTML).
  http.all(url('/*'), ({request}) =>
    fail(501, 'not_mocked', `The mock API has no handler for ${request.method} ${new URL(request.url).pathname} yet.`),
  ),
];
