import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {job} from '@/test/fakeApi';
import {ApiError} from './client';
import {POLL_MS, waitForJob} from './projects';

// waitForJob polls G1 (API design: every 2 s), stops when asked, and rides out short connection
// trouble (QF5-011 in QA_REPORT_F5). `fetch` is scripted answer by answer.

type Step = 'network' | {status: number; body: unknown};
let steps: Step[];
let fetches: string[];

const running = (): Step => ({status: 200, body: {job: job({id: 'j1', state: 'running'})}});
const done = (): Step => ({status: 200, body: {job: job({id: 'j1', state: 'succeeded', output: {ok: true}})}});

beforeEach(() => {
  vi.useFakeTimers();
  fetches = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetches.push(url);
      const step = steps.shift() ?? done();
      if (step === 'network') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(step.body), {status: step.status, headers: {'Content-Type': 'application/json'}});
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Starts waiting and records how it ends, without leaving a rejection unhandled. */
function start(signal?: AbortSignal) {
  const outcome: {value?: unknown; error?: unknown; settled: boolean} = {settled: false};
  void waitForJob('j1', signal).then(
    (value) => Object.assign(outcome, {value, settled: true}),
    (error: unknown) => Object.assign(outcome, {error, settled: true}),
  );
  return outcome;
}

describe('waitForJob', () => {
  it('asks G1 for the job every 2 seconds until it has finished', async () => {
    expect(POLL_MS).toBe(2000);
    steps = [running(), running(), done()];
    const outcome = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatch(/\/jobs\/j1$/);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetches).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetches).toHaveLength(3);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toMatchObject({id: 'j1', state: 'succeeded'});
  });

  it('returns a failed job as it is (the caller reads its error)', async () => {
    steps = [{status: 200, body: {job: job({state: 'failed', error: {code: 'provider_failed', message: 'No.'}})}}];
    const outcome = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.value).toMatchObject({state: 'failed', error: {message: 'No.'}});
  });

  it('stops when the signal is aborted, without asking again', async () => {
    steps = [running(), running(), running()];
    const controller = new AbortController();
    const outcome = start(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toHaveLength(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(2000);
    expect(outcome.settled).toBe(true);
    expect((outcome.error as DOMException).name).toBe('AbortError');
    expect(fetches).toHaveLength(1);
  });

  it('a signal that is already aborted asks nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = start(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.error as DOMException).name).toBe('AbortError');
    expect(fetches).toHaveLength(0);
  });

  it('rides out up to 3 connection errors in a row', async () => {
    steps = ['network', 'network', running(), 'network', 'network', 'network', done()];
    const outcome = start();
    await vi.advanceTimersByTimeAsync(7 * 2000);
    expect(outcome.error).toBeUndefined();
    expect(outcome.value).toMatchObject({state: 'succeeded'});
    expect(fetches).toHaveLength(7);
  });

  it('gives up on the 4th connection error in a row', async () => {
    steps = ['network', 'network', 'network', 'network', done()];
    const outcome = start();
    await vi.advanceTimersByTimeAsync(5 * 2000);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(ApiError);
    expect((outcome.error as ApiError).code).toBe('network_error');
    expect(fetches).toHaveLength(4);
  });

  it('an answer such as 404 is final, not retried', async () => {
    steps = [{status: 404, body: {error: {code: 'not_found', message: "We couldn't find that."}}}, done()];
    const outcome = start();
    await vi.advanceTimersByTimeAsync(4000);
    expect((outcome.error as ApiError).status).toBe(404);
    expect(fetches).toHaveLength(1);
  });
});
