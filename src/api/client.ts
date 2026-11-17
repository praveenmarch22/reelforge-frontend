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

  if (res.status === 401 && !path.startsWith('/auth/')) {
    const body = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error.code === 'token_expired' && (await refreshSession())) {
      res = await send(path, options);
    }
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
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
