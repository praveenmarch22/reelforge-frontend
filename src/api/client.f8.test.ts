import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {api, ApiError, setInsufficientCreditsHandler, setUnauthenticatedHandler} from './client';

// F8 changes to the client (API A11, A12; docs/SCREENS_F8.md section 2): a 401 invalid_credentials
// from a signed-in endpoint is an answer, not a lost session; a 402 insufficient_credits is
// announced to the app.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const error = (status: number, code: string, details?: Record<string, unknown>) =>
  json(status, {error: {code, message: `${code}!`, ...(details ? {details} : {})}});

let fetchMock: ReturnType<typeof vi.fn>;
let signedOut: ReturnType<typeof vi.fn>;
let outOfCredits: ReturnType<typeof vi.fn>;

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('Expected the request to fail, but it succeeded');
}
const paths = () => fetchMock.mock.calls.map(([url]) => String(url).replace('/api/v1', ''));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  signedOut = vi.fn();
  outOfCredits = vi.fn();
  setUnauthenticatedHandler(signedOut);
  setInsufficientCreditsHandler(outOfCredits);
});
afterEach(() => {
  setUnauthenticatedHandler(null);
  setInsufficientCreditsHandler(null);
  vi.unstubAllGlobals();
});

describe('api: a wrong password is not a lost session (A11, A12)', () => {
  it.each([
    ['POST', '/me/password', {currentPassword: 'x', newPassword: 'y'}],
    ['DELETE', '/me', {password: 'x'}],
  ] as const)('%s %s answered 401 invalid_credentials throws the error and does not sign out or refresh', async (method, path, body) => {
    fetchMock.mockResolvedValueOnce(error(401, 'invalid_credentials'));

    const e = await failure(api(path, {method, body}));

    expect(e).toMatchObject({status: 401, code: 'invalid_credentials'});
    expect(signedOut).not.toHaveBeenCalled();
    expect(paths()).toEqual([path]);
  });

  it('an expired token is refreshed first; a wrong password after that still does not sign out', async () => {
    fetchMock
      .mockResolvedValueOnce(error(401, 'token_expired'))
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(error(401, 'invalid_credentials'));

    const e = await failure(api('/me/password', {method: 'POST', body: {currentPassword: 'x', newPassword: 'y'}}));

    expect(e.code).toBe('invalid_credentials');
    expect(paths()).toEqual(['/me/password', '/auth/refresh', '/me/password']);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it.each(['not_authenticated', 'token_invalid'])('a 401 %s still signs the user out', async (code) => {
    fetchMock.mockResolvedValueOnce(error(401, code));

    await failure(api('/me/password', {method: 'POST', body: {}}));

    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it('an expired token whose refresh fails signs the user out', async () => {
    fetchMock.mockResolvedValueOnce(error(401, 'token_expired')).mockResolvedValueOnce(error(401, 'not_authenticated'));

    await failure(api('/me', {method: 'DELETE', body: {password: 'x'}}));

    expect(signedOut).toHaveBeenCalledTimes(1);
  });
});

describe('api: 402 insufficient_credits is announced', () => {
  it('calls the handler with the details and still throws the error to the caller', async () => {
    const details = {needed: 10, balance: 3, resetsAt: '2026-12-01T00:00:00Z'};
    fetchMock.mockResolvedValueOnce(error(402, 'insufficient_credits', details));

    const e = await failure(api('/projects/p1/generate', {method: 'POST'}));

    expect(e).toMatchObject({status: 402, code: 'insufficient_credits', details});
    expect(outOfCredits).toHaveBeenCalledTimes(1);
    expect(outOfCredits).toHaveBeenCalledWith(details);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('passes an empty object when the API sent no details', async () => {
    fetchMock.mockResolvedValueOnce(error(402, 'insufficient_credits'));

    await failure(api('/projects/p1/generate', {method: 'POST'}));

    expect(outOfCredits).toHaveBeenCalledWith({});
  });

  it.each([
    [402, 'something_else'],
    [403, 'insufficient_credits'],
    [409, 'already_running'],
  ])('does not call it for %i %s', async (status, code) => {
    fetchMock.mockResolvedValueOnce(error(status, code));

    await failure(api('/projects/p1/generate', {method: 'POST'}));

    expect(outOfCredits).not.toHaveBeenCalled();
  });

  it('works with no handler registered', async () => {
    setInsufficientCreditsHandler(null);
    fetchMock.mockResolvedValueOnce(error(402, 'insufficient_credits', {needed: 1}));

    expect((await failure(api('/x', {method: 'POST'}))).code).toBe('insufficient_credits');
  });
});
