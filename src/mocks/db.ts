// In-browser stand-in for the backend database. Development only.
// Data lives in localStorage so it survives reloads; resetMockDb() starts again from the seed.
// Passwords are stored in plain text here because this is fake data in your own browser;
// the real backend hashes them (see docs/DB_DESIGN.md in the reelforge-backend repository).

import type {Credits, InstagramStatus, ProjectSummary, User} from '@/api/types';

const KEY = 'rf_mock_db_v1';
export const DEV_LINK_KEY = 'rf_mock_last_link';

export type DbUser = Omit<User, 'credits' | 'instagram'> & {password: string};
export type DbToken = {token: string; userId: string; kind: 'verify_email' | 'reset_password'; used: boolean};
export type DbProject = ProjectSummary & {userId: string};

export type Db = {
  users: DbUser[];
  sessionUserId: string | null;
  tokens: DbToken[];
  projects: DbProject[];
  credits: Record<string, Credits>;
  instagram: Record<string, InstagramStatus>;
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
