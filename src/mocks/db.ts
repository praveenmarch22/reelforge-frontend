// In-browser stand-in for the backend database. Development only.
// Data lives in localStorage so it survives reloads; resetMockDb() starts again from the seed.
// Passwords are stored in plain text here because this is fake data in your own browser;
// the real backend hashes them (see docs/DB_DESIGN.md in the reelforge-backend repository).

import type {Connection, Credits, InstagramStatus, ProjectSummary, User, Voice} from '@/api/types';

const KEY = 'rf_mock_db_v1';
export const DEV_LINK_KEY = 'rf_mock_last_link';

export type DbUser = Omit<User, 'credits' | 'instagram' | 'connections'> & {password: string};
export type DbToken = {token: string; userId: string; kind: 'verify_email' | 'reset_password'; used: boolean};
export type DbProject = ProjectSummary & {userId: string};

/** A started "Connect Instagram" attempt, waiting for the (mock) Instagram approval screen. */
export type DbOAuthState = {state: string; userId: string; returnTo: string; createdAt?: number};

export type Db = {
  users: DbUser[];
  sessionUserId: string | null;
  tokens: DbToken[];
  projects: DbProject[];
  credits: Record<string, Credits>;
  instagram: Record<string, InstagramStatus>;
  /** Added in F4; absent in databases saved by older versions. */
  oauthStates?: DbOAuthState[];
  /** Connected YouTube channels (F7); absent in databases saved by older versions. */
  youtube?: Record<string, Connection>;
};

// Demo account for local testing. Listed in frontend/README.md.
export const DEMO_EMAIL = 'demo@reelforge.test';
export const DEMO_PASSWORD = 'reelforge-demo';
const DEMO_ID = '00000000-0000-4000-8000-000000000001';

const daysFromNow = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 6e4).toISOString();

const NOT_CONNECTED: InstagramStatus = {connected: false, username: null, status: null, expiresAt: null};

function seed(): Db {
  const project = (
    n: number,
    title: string,
    status: ProjectSummary['status'],
    mode: ProjectSummary['mode'],
    seconds: number | null,
    ago: number,
    progress: number | null = null,
  ): DbProject => ({
    id: `10000000-0000-4000-8000-00000000000${n}`,
    userId: DEMO_ID,
    title,
    mode,
    status,
    targetSeconds: 30,
    durationSeconds: seconds,
    thumbnailUrl: null,
    progress,
    updatedAt: minutesAgo(ago),
  });

  return {
    users: [
      {
        id: DEMO_ID,
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: 'Praveen',
        niche: 'Productivity',
        emailVerified: true,
        defaults: {voiceId: '', captionStyle: 'bold-pop', mode: 'faceless'},
        onboardingCompleted: true,
        isAdmin: true,
      },
    ],
    sessionUserId: null,
    tokens: [],
    projects: [
      project(1, 'Morning dopamine reset', 'posted', 'faceless', 31, 60 * 26),
      project(2, '3 AI tools for high output', 'ready', 'faceless', 45, 60 * 5),
      project(3, 'Hyperfocus in 5 minutes', 'generating', 'full_ai', null, 2, 58),
      project(4, 'Why most creators quit', 'draft', 'faceless', null, 60 * 48),
      project(5, 'Cinematic Tokyo night run', 'render_failed', 'full_ai', 15, 60 * 3),
      project(6, 'The 2-minute rule, explained', 'posted', 'faceless', 28, 60 * 72),
      project(7, 'How I plan my week on Sunday', 'rendered', 'faceless', 58, 60 * 30),
    ],
    credits: {[DEMO_ID]: {balance: 86, monthlyAllowance: 100, resetsAt: daysFromNow(19)}},
    instagram: {
      [DEMO_ID]: {connected: true, username: 'praveen_fit', status: 'connected', expiresAt: daysFromNow(52)},
    },
  };
}

export function loadDb(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    // Corrupt or unavailable storage: fall through to a fresh seed.
  }
  const db = seed();
  saveDb(db);
  return db;
}

export function saveDb(db: Db): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Storage full or blocked: the mock still works for this page load.
  }
}

export function resetMockDb(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(DEV_LINK_KEY);
}

export function toUser(db: Db, u: DbUser): User {
  const {password: _password, ...rest} = u;
  return {
    ...rest,
    credits: db.credits[u.id] ?? {balance: 0, monthlyAllowance: 100, resetsAt: daysFromNow(30)},
    instagram: db.instagram[u.id] ?? NOT_CONNECTED,
    connections: {youtube: db.youtube?.[u.id] ?? null, instagram: null},
  };
}

export function createUser(db: Db, input: {name: string; email: string; password: string}): DbUser {
  const user: DbUser = {
    id: crypto.randomUUID(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    name: input.name.trim(),
    niche: '',
    emailVerified: false,
    defaults: {voiceId: '', captionStyle: 'bold-pop', mode: 'faceless'},
    onboardingCompleted: false,
    isAdmin: false,
  };
  db.users.push(user);
  db.credits[user.id] = {balance: 100, monthlyAllowance: 100, resetsAt: daysFromNow(30)};
  db.instagram[user.id] = NOT_CONNECTED;
  return user;
}

/** Creates a one-time token and remembers its link, since the mock can't send email. */
export function issueToken(db: Db, userId: string, kind: DbToken['kind']): string {
  const token = crypto.randomUUID().replace(/-/g, '');
  db.tokens.push({token, userId, kind, used: false});
  const link = kind === 'verify_email' ? `/verify?token=${token}` : `/reset?token=${token}`;
  try {
    localStorage.setItem(DEV_LINK_KEY, JSON.stringify({kind, link}));
  } catch {
    // ignore
  }
  console.info(`[mock api] ${kind} link: ${location.origin}${link}`);
  return token;
}

export function readDevLink(kind: DbToken['kind']): string | null {
  try {
    const raw = localStorage.getItem(DEV_LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {kind: string; link: string};
    return parsed.kind === kind ? parsed.link : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- voices (API D3)

/** A short tone as a WAV data URL. Stands in for a real voice sample in mock mode. */
function toneDataUrl(frequency: number): string {
  const rate = 8000;
  const samples = Math.floor(rate * 0.9);
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  text(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 400, (samples - i) / 1200);
    bytes[44 + i] = 128 + Math.round(60 * fade * Math.sin((2 * Math.PI * frequency * i) / rate));
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const VOICE_SEED = [
  {id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'Female', accent: 'American', style: 'Warm', tone: 262},
  {id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'Male', accent: 'American', style: 'Deep', tone: 131},
  {id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'Female', accent: 'American', style: 'Soft', tone: 330},
  {id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'Male', accent: 'American', style: 'Calm', tone: 165},
  {id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'Female', accent: 'American', style: 'Energetic', tone: 392},
  {id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'Male', accent: 'American', style: 'Confident', tone: 196},
] as const;

export function listVoices(): Voice[] {
  return VOICE_SEED.map(({tone, ...voice}) => ({...voice, provider: 'elevenlabs', previewUrl: toneDataUrl(tone)}));
}

// ---------------------------------------------------------------- Instagram connect (API F1, F2)

export type InstagramOutcome = 'creator' | 'business' | 'personal_account' | 'denied' | 'not_tester';

export const DEFAULT_RETURN_TO = '/app/settings';
export const RETURN_TO_MAX_LENGTH = 300;
export const OAUTH_STATE_MINUTES = 10;
const FAILED = `${DEFAULT_RETURN_TO}?instagram=error&reason=failed`;

/**
 * The return address rule from API F1. Only a path inside the web app is accepted; anything
 * that a browser could read as another site falls back to the default. Browsers treat "\" as
 * "/" and ignore tabs and line breaks in addresses, so those are refused outright.
 * The result has no "#fragment" and no leftover instagram/reason parameters.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > RETURN_TO_MAX_LENGTH) return DEFAULT_RETURN_TO;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_RETURN_TO;
  }
  const base = 'http://app.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (url.origin !== base) return DEFAULT_RETURN_TO;
  url.searchParams.delete('instagram');
  url.searchParams.delete('reason');
  const result = url.pathname + url.search;
  // Resolving removes "/./" and "/../", which can leave a "//host" start that was not in the
  // value as given ("/.//evil.example"). The check is made again on what will be used.
  if (result.startsWith('//')) return DEFAULT_RETURN_TO;
  return result;
}

export function startInstagramConnect(db: Db, userId: string, returnTo: string): string {
  const state = crypto.randomUUID().replace(/-/g, '');
  db.oauthStates = [
    ...(db.oauthStates ?? []).filter((s) => s.userId !== userId),
    {state, userId, returnTo: safeReturnTo(returnTo), createdAt: Date.now()},
  ];
  return state;
}

/**
 * What the real backend does in F2 after Instagram redirects back: checks the state,
 * stores the account (or not), and returns where to send the browser.
 */
export function finishInstagramConnect(state: string, outcome: InstagramOutcome, username: string): string {
  const db = loadDb();
  const pending = (db.oauthStates ?? []).find((s) => s.state === state);
  if (!pending) return FAILED;
  db.oauthStates = (db.oauthStates ?? []).filter((s) => s.state !== state); // one use only

  const expired = Date.now() - (pending.createdAt ?? 0) > OAUTH_STATE_MINUTES * 60_000;
  // The person approving must be the signed-in user who started the connection.
  const wrongUser = db.sessionUserId !== pending.userId;
  if (expired || wrongUser) {
    saveDb(db);
    return FAILED;
  }

  const url = new URL(safeReturnTo(pending.returnTo), 'http://app.invalid');
  if (outcome === 'creator' || outcome === 'business') {
    db.instagram[pending.userId] = {
      connected: true,
      username: username.trim().replace(/^@/, '') || 'your_handle',
      status: 'connected',
      expiresAt: daysFromNow(60),
    };
    url.searchParams.set('instagram', 'connected');
  } else {
    url.searchParams.set('instagram', 'error');
    url.searchParams.set('reason', outcome);
  }
  saveDb(db);
  return url.pathname + url.search;
}
