// A small stand-in for the backend in component tests: `fetch` is replaced, every request is
// recorded, and each test says how the endpoints it uses answer. The MSW mock in src/mocks is
// not used for the F5 screens (they run against the real backend in development).

import {vi} from 'vitest';
import type {CreditsInfo, Estimate, Job, Project, Scene, User, Voice} from '@/api/types';
import {loadDb, toUser} from '@/mocks/db';

export type FakeRequest = {method: string; path: string; body: any; headers: Record<string, string>};
export type FakeAnswer = {status?: number; body?: unknown};
type Handler = (req: FakeRequest, params: Record<string, string>) => FakeAnswer | Promise<FakeAnswer>;

export type FakeApi = {
  requests: FakeRequest[];
  on: (route: string, handler: Handler) => void;
  /** Requests to this method and path pattern, oldest first. */
  calls: (route: string) => FakeRequest[];
};

const API = '/api/v1';

function match(pattern: string, method: string, path: string): Record<string, string> | null {
  const [m, p] = pattern.split(' ');
  if (m !== method) return null;
  const want = p.split('/');
  const got = path.split('?')[0].split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

export function installFakeApi(): FakeApi {
  const handlers: [string, Handler][] = [];
  const requests: FakeRequest[] = [];

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const req = {method, path, body, headers};
    requests.push(req);
    for (const [route, handler] of [...handlers].reverse()) {
      const params = match(route, method, path);
      if (params) {
        const {status = 200, body: answer} = await handler(req, params);
        if (status === 204) return new Response(null, {status});
        return new Response(JSON.stringify(answer ?? {}), {status, headers: {'Content-Type': 'application/json'}});
      }
    }
    return new Response(JSON.stringify({error: {code: 'not_found', message: `no fake for ${method} ${path}`}}), {
      status: 404,
      headers: {'Content-Type': 'application/json'},
    });
  });
  vi.stubGlobal('fetch', fetchStub);

  return {
    requests,
    on: (route, handler) => handlers.push([route, handler]),
    calls: (route) => requests.filter((r) => match(route, r.method, r.path)),
  };
}

export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>): FakeAnswer {
  return {status, body: {error: {code, message, ...(details ? {details} : {})}}};
}

// ---------------------------------------------------------------- objects

export function user(over: Partial<User> = {}): User {
  const db = loadDb();
  return {...toUser(db, db.users[0]), onboardingCompleted: true, ...over};
}

export const VOICES: Voice[] = [
  {id: 'v-liam', name: 'Liam', provider: 'elevenlabs', gender: 'Male', accent: 'American', style: 'Energetic', previewUrl: 'https://x/liam.mp3'},
  {id: 'v-laura', name: 'Laura', provider: 'elevenlabs', gender: 'Female', accent: 'American', style: 'Upbeat', previewUrl: ''},
  {id: 'v-george', name: 'George', provider: 'elevenlabs', gender: 'Male', accent: 'British', style: 'Storyteller', previewUrl: ''},
];

export function credits(balance = 99): CreditsInfo {
  return {
    balance,
    monthlyAllowance: 100,
    resetsAt: '2026-12-01T00:00:00Z',
    costs: {script: 1, voicePer30s: 2, voiceSceneShort: 1, aiImage: 1, aiVideoClip: 10, render: 2, ideas: 0, hooks: 0, rewrite: 1},
  } as CreditsInfo;
}

export function scene(n: number, over: Partial<Scene> = {}): Scene {
  const narration = over.narration ?? `Scene ${n} narration goes here.`;
  return {
    id: `s${n}`,
    position: n,
    narration,
    onScreenText: `Text ${n}`,
    visualPrompt: `prompt ${n}`,
    stockQuery: `query ${n}`,
    mood: 'calm',
    visualSource: 'stock',
    estimatedSeconds: Math.round((narration.trim().split(/\s+/).length / 2.5) * 10) / 10,
    voiceStatus: 'missing',
    visualStatus: 'missing',
    voice: null,
    visual: null,
    words: [],
    wordsEdited: false,
    trimStart: 0,
    trimEnd: null,
    lastError: null,
    ...over,
  };
}

export function project(over: Partial<Project> = {}, scenes = [scene(1), scene(2), scene(3)]): Project {
  const estimated = Math.round(scenes.reduce((s, x) => s + x.estimatedSeconds, 0) * 10) / 10;
  return {
    id: 'p1',
    title: 'Three morning habits',
    mode: 'faceless',
    status: 'draft',
    targetSeconds: 30,
    durationSeconds: null,
    thumbnailUrl: null,
    progress: null,
    updatedAt: '2026-11-26T10:00:00Z',
    topic: 'morning habits',
    tone: 'educational',
    style: '',
    character: '',
    voiceId: 'v-laura',
    musicMood: 'inspiring',
    music: null,
    settings: {captionStyle: 'bold-pop', showCaptions: true, voiceVolume: 1, musicVolume: 0.25, duckedVolume: 0.08, ducking: true, transition: 'cut'},
    estimatedSeconds: estimated,
    wordCount: scenes.reduce((s, x) => s + x.narration.trim().split(/\s+/).length, 0),
    timelineVersion: 1,
    postTitle: '',
    postCaption: '',
    hashtags: [],
    scenes,
    activeJobs: [],
    latestRender: null,
    latestPost: null,
    createdAt: '2026-11-26T10:00:00Z',
    ...over,
  } as Project;
}

export function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    type: 'ideas',
    projectId: null,
    sceneId: null,
    state: 'queued',
    progress: 0,
    provider: null,
    creditsReserved: 0,
    creditsRefunded: false,
    error: null,
    output: null,
    queuedAt: '2026-11-26T10:00:00Z',
    finishedAt: null,
    ...over,
  };
}

export function estimate(creditsNeeded = 4, balance = 99): Estimate {
  return {credits: creditsNeeded, balance, items: [{type: 'voice', count: 3, credits: creditsNeeded}]};
}

/** The endpoints every F5 screen reads: me, voices and credits. */
export function withBasics(api: FakeApi, over: {me?: User; balance?: number} = {}) {
  api.on('GET /me', () => ({body: {user: over.me ?? user()}}));
  api.on('GET /voices', () => ({body: {items: VOICES}}));
  api.on('GET /credits', () => ({body: credits(over.balance ?? 99)}));
}
