import {API_URL} from '@/lib/env';
import type {ApiErrorBody} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  /** Per-field messages from a 400 validation_error. */
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) ?? {};
  }
}

type Options = {method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; idempotencyKey?: string};

const csrfToken = () => document.cookie.match(/(?:^|; )rf_csrf=([^;]*)/)?.[1] ?? '';

async function send(path: string, {method = 'GET', body, idempotencyKey}: Options): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = decodeURIComponent(csrfToken());
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  try {
    return await fetch(API_URL + path, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', "Can't reach ReelForge. Check your connection and try again.");
  }
}

// Endpoints that work without a session. A 401 from these is an answer (for example a wrong
// password), not an expired session, so they are never refreshed or treated as "signed out".
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/signup',
  '/auth/refresh',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
];
const isPublic = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}?`));

let onUnauthenticated: (() => void) | null = null;

/** Registers what to do when the session turns out to be gone (the app sends the user to login). */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

let refreshing: Promise<boolean> | null = null;

/** One shared refresh at a time, so parallel requests don't each rotate the token. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send('/auth/refresh', {method: 'POST'})
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let res = await send(path, options);

  if (res.status === 401 && !isPublic(path)) {
    const body = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error.code === 'token_expired' && (await refreshSession())) {
      res = await send(path, options);
    }
    // Still 401: the session is gone (logged out elsewhere, or the refresh failed).
    if (res.status === 401) onUnauthenticated?.();
  }

  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get('Content-Type') ?? '').includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.ok && !isJson) {
    // A successful non-JSON answer means the request never reached the API
    // (for example the dev server answered with the app's HTML).
    throw new ApiError(res.status, 'unexpected_response', 'Something went wrong. Please try again.');
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'unknown_error',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
    );
  }
  return data as T;
}
