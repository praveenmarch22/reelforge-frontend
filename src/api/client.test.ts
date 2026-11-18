import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {api, ApiError, setUnauthenticatedHandler} from './client';

// Contract under test: API_DESIGN.md section 2 (conventions, error format, error codes).

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
const errorBody = (code: string, message: string, details?: Record<string, unknown>) => ({error: {code, message, details}});
const tokenExpired = () => json(401, errorBody('token_expired', 'Your session expired.'));

type Call = {url: string; method: string; headers: Record<string, string>; body: unknown; credentials: unknown};

let fetchMock: ReturnType<typeof vi.fn>;

function calls(): Call[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
    credentials: init?.credentials,
  }));
}

/** Resolves with the ApiError the call threw, so its fields can be asserted. */
async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('Expected the request to fail, but it succeeded');
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setUnauthenticatedHandler(null);
  vi.unstubAllGlobals();
  document.cookie = 'rf_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('api: requests', () => {
  it('sends a GET to /api/v1 with cookies and returns the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {user: {id: 'u1'}}));

    await expect(api('/me')).resolves.toEqual({user: {id: 'u1'}});

    const [call] = calls();
    expect(call.url).toBe('/api/v1/me');
    expect(call.method).toBe('GET');
    expect(call.credentials).toBe('include');
    expect(call.body).toBeUndefined();
    expect(call.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it.each(['POST', 'PATCH', 'DELETE'] as const)('sends X-CSRF-Token from the rf_csrf cookie on %s', async (method) => {
    document.cookie = 'rf_csrf=abc%2F123; path=/';
    fetchMock.mockResolvedValueOnce(json(200, {}));

    await api('/me', {method, body: method === 'DELETE' ? undefined : {name: 'A'}});

    expect(calls()[0].headers['X-CSRF-Token']).toBe('abc/123');
  });

  it('sends the body as JSON with a JSON content type', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));

    await api('/auth/login', {method: 'POST', body: {email: 'a@b.com', password: 'x'}});

    const [call] = calls();
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toEqual({email: 'a@b.com', password: 'x'});
  });

  it('sends the Idempotency-Key header when one is given', async () => {
    fetchMock.mockResolvedValueOnce(json(202, {}));

    await api('/projects', {method: 'POST', body: {}, idempotencyKey: 'key-1'});

    expect(calls()[0].headers['Idempotency-Key']).toBe('key-1');
  });

  it('resolves with undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {status: 204}));

    await expect(api('/auth/logout', {method: 'POST'})).resolves.toBeUndefined();
  });
});

describe('api: error mapping', () => {
  it('maps the error envelope to ApiError with status, code, message and details', async () => {
    fetchMock.mockResolvedValueOnce(
      json(402, errorBody('insufficient_credits', 'This needs 12 credits; you have 5.', {needed: 12, balance: 5})),
    );

    const err = await failure(api('/projects', {method: 'POST', body: {}}));

    expect(err.status).toBe(402);
    expect(err.code).toBe('insufficient_credits');
    expect(err.message).toBe('This needs 12 credits; you have 5.');
    expect(err.details).toEqual({needed: 12, balance: 5});
    expect(err.fields).toEqual({});
  });

  it('exposes details.fields of a validation_error as fields', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, errorBody('validation_error', 'Please check the form.', {fields: {narration: 'Required'}})),
    );

    const err = await failure(api('/x', {method: 'POST', body: {}}));

    expect(err.code).toBe('validation_error');
    expect(err.fields).toEqual({narration: 'Required'});
  });

  it.each([
    [409, 'email_taken'],
    [410, 'token_invalid'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
  ])('keeps the status %i and code %s', async (status, code) => {
    fetchMock.mockResolvedValueOnce(json(status, errorBody(code, 'msg')));

    const err = await failure(api('/x'));

    expect([err.status, err.code]).toEqual([status, code]);
  });

  it('falls back to a generic error when the failure body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', {status: 502}));

    const err = await failure(api('/me'));

    expect(err.status).toBe(502);
    expect(err.code).toBe('unknown_error');
    expect(err.message).toBe('Something went wrong. Please try again.');
  });

  it('reports a network failure as network_error with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await failure(api('/me'));

    expect(err.status).toBe(0);
    expect(err.code).toBe('network_error');
    expect(err.message).toMatch(/can't reach reelforge/i);
  });
});

describe('api: unexpected answers', () => {
  // A request that never reached the API (for example a dev server answering with the app's HTML page).
  it('treats a 2xx answer that is not JSON as an error, not as empty data', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html><html></html>', {status: 200, headers: {'Content-Type': 'text/html'}}),
    );

    const err = await failure(api('/credits/ledger'));

    expect(err.status).toBe(200);
    expect(err.code).toBe('unexpected_response');
    expect(err.message).toBe('Something went wrong. Please try again.');
  });

  it('accepts JSON with a charset in the content type', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {status: 200, headers: {'Content-Type': 'application/json; charset=utf-8'}}),
    );

    await expect(api('/me')).resolves.toEqual({ok: true});
  });

  it('maps a 501 not_mocked from the mock API like any other error', async () => {
    fetchMock.mockResolvedValueOnce(json(501, errorBody('not_mocked', 'The mock API has no handler for GET /api/v1/ideas yet.')));

    const err = await failure(api('/ideas'));

    expect([err.status, err.code]).toEqual([501, 'not_mocked']);
  });
});

describe('api: session lost', () => {
  const notAuthenticated = () => json(401, errorBody('not_authenticated', 'Please log in to continue.'));
  let onLost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onLost = vi.fn();
    setUnauthenticatedHandler(onLost);
  });

  it.each([
    ['GET', '/me'],
    ['GET', '/projects?status=posted'],
    ['DELETE', '/projects/p1'],
    ['POST', '/auth/logout'],
    ['POST', '/auth/resend-verification'],
  ] as const)('tells the app when %s %s answers 401 not_authenticated', async (method, path) => {
    fetchMock.mockResolvedValueOnce(notAuthenticated());

    const err = await failure(api(path, {method}));

    expect(err.status).toBe(401);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('tells the app when the token expired and the refresh is refused', async () => {
    fetchMock.mockResolvedValueOnce(tokenExpired()).mockResolvedValueOnce(notAuthenticated());

    await failure(api('/projects'));

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('tells the app when the token expired and the refresh cannot reach the server', async () => {
    fetchMock.mockResolvedValueOnce(tokenExpired()).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await failure(api('/projects'));

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('tells the app when the retry after a refresh is still 401', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {}}))
      .mockResolvedValueOnce(notAuthenticated());

    await failure(api('/projects'));

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the refresh and the retry succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {}}))
      .mockResolvedValueOnce(json(200, {items: []}));

    await expect(api('/projects')).resolves.toEqual({items: []});
    expect(onLost).not.toHaveBeenCalled();
  });

  // A 401 from these is an answer to the request (wrong password, no refresh cookie), not a lost session.
  it.each([
    '/auth/login',
    '/auth/signup',
    '/auth/refresh',
    '/auth/verify-email',
    '/auth/forgot-password',
    '/auth/reset-password',
  ])('says nothing, and does not refresh, when the public endpoint %s answers 401', async (path) => {
    fetchMock.mockResolvedValueOnce(tokenExpired());

    const err = await failure(api(path, {method: 'POST', body: {}}));

    expect(err.status).toBe(401);
    expect(calls()).toHaveLength(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])('says nothing for a %i', async (status) => {
    fetchMock.mockResolvedValueOnce(json(status, errorBody('some_error', 'msg')));

    await failure(api('/projects'));

    expect(onLost).not.toHaveBeenCalled();
  });

  it('says nothing for a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await failure(api('/projects'));

    expect(onLost).not.toHaveBeenCalled();
  });

  it('works without a handler registered', async () => {
    setUnauthenticatedHandler(null);
    fetchMock.mockResolvedValueOnce(notAuthenticated());

    const err = await failure(api('/me'));

    expect(err.code).toBe('not_authenticated');
  });
});

describe('api: expired access token', () => {
  it('refreshes the session once and retries the original request', async () => {
    document.cookie = 'rf_csrf=tok; path=/';
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {id: 'u1'}})) // refresh
      .mockResolvedValueOnce(json(200, {project: {id: 'p1'}}));

    const result = await api('/projects/p1', {method: 'PATCH', body: {title: 'New'}});

    expect(result).toEqual({project: {id: 'p1'}});
    expect(calls()).toHaveLength(3);
    const [first, refresh, retry] = calls();
    expect(first.url).toBe('/api/v1/projects/p1');
    expect([refresh.url, refresh.method]).toEqual(['/api/v1/auth/refresh', 'POST']);
    expect(refresh.headers['X-CSRF-Token']).toBe('tok');
    expect(refresh.credentials).toBe('include');
    // The retry is the same request again.
    expect([retry.url, retry.method, retry.body]).toEqual(['/api/v1/projects/p1', 'PATCH', {title: 'New'}]);
  });

  it('returns undefined when the retried request answers 204', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {}}))
      .mockResolvedValueOnce(new Response(null, {status: 204}));

    await expect(api('/projects/p1', {method: 'DELETE'})).resolves.toBeUndefined();
  });

  it('throws the 401 and does not retry when the refresh is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(401, errorBody('not_authenticated', 'Please log in to continue.')));

    const err = await failure(api('/me'));

    expect(err.status).toBe(401);
    expect(calls()).toHaveLength(2);
  });

  it('throws the 401 when the refresh call cannot reach the server', async () => {
    fetchMock.mockResolvedValueOnce(tokenExpired()).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await failure(api('/me'));

    expect(err.status).toBe(401);
    expect(calls()).toHaveLength(2);
  });

  it('throws the error of the retried request when that fails too', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {}}))
      .mockResolvedValueOnce(json(404, errorBody('not_found', "We couldn't find that Reel.")));

    const err = await failure(api('/projects/p1'));

    expect([err.status, err.code]).toEqual([404, 'not_found']);
  });

  it('does not refresh for other 401s (no session)', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody('not_authenticated', 'Please log in to continue.')));

    const err = await failure(api('/me'));

    expect(err.code).toBe('not_authenticated');
    expect(calls()).toHaveLength(1);
  });

  it('does not refresh when login answers 401 invalid_credentials', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody('invalid_credentials', 'Wrong email or password.')));

    const err = await failure(api('/auth/login', {method: 'POST', body: {email: 'a@b.com', password: 'x'}}));

    expect(err.code).toBe('invalid_credentials');
    expect(calls()).toHaveLength(1);
  });

  it('shares one refresh between requests that expire at the same time', async () => {
    let refreshCalls = 0;
    const seen = new Set<string>();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        // A real refresh takes a network round trip; the other 401s arrive while it is in flight.
        await new Promise((resolve) => setTimeout(resolve, 30));
        return json(200, {user: {}});
      }
      if (!seen.has(url)) {
        seen.add(url);
        return tokenExpired();
      }
      return json(200, {url});
    });

    const results = await Promise.all([api('/projects'), api('/credits'), api('/me')]);

    expect(results).toEqual([{url: '/api/v1/projects'}, {url: '/api/v1/credits'}, {url: '/api/v1/me'}]);
    expect(refreshCalls).toBe(1);
  });

  it('refreshes again the next time a token expires', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {}}))
      .mockResolvedValueOnce(json(200, {n: 1}))
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, {user: {}}))
      .mockResolvedValueOnce(json(200, {n: 2}));

    await expect(api('/me')).resolves.toEqual({n: 1});
    await expect(api('/me')).resolves.toEqual({n: 2});
    expect(calls().filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(2);
  });

  // A3 (resend-verification) and A6 (logout) are "User" endpoints: they need a valid access token,
  // so they can answer 401 token_expired like any other. API_DESIGN.md: "call /auth/refresh and retry".
  it.each(['/auth/resend-verification', '/auth/logout'])(
    'refreshes and retries %s, which needs a signed-in user',
    async (path) => {
      let attempts = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/auth/refresh')) return json(200, {user: {}});
        attempts++;
        return attempts === 1 ? tokenExpired() : new Response(null, {status: 204});
      });

      await expect(api(path, {method: 'POST'})).resolves.toBeUndefined();
      expect(calls().map((c) => c.url)).toEqual([`/api/v1${path}`, '/api/v1/auth/refresh', `/api/v1${path}`]);
    },
  );
});
