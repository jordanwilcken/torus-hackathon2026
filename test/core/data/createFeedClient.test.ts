import { afterEach, expect, test, vi } from 'vitest';
import { createFeedClient } from '../../../src/data/createFeedClient';

type Reading = { value: number; retrievedAt: string; intervalEnd: string };
const first = { value: 5000, retrievedAt: '2026-10-28T07:15:00Z', intervalEnd: '2026-10-28T06:00:00Z' };
const second = { ...first, value: 5100, retrievedAt: '2026-10-28T07:30:00Z' };
function ready(snapshot = first, revision = 'eia-one') {
  return { status: 'ready', snapshot, revision, lastAttemptAt: snapshot.retrievedAt, nextRefreshAt: null };
}
function response(value: unknown) { return Response.json(value); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(finish => { resolve = finish; }), resolve };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test('independent consumers share one request and the same immutable publication through a refresh', async () => {
  const incoming = deferred<Response>();
  let calls = 0;
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => { calls++; return incoming.promise; } });
  const seenA: unknown[] = [], seenB: unknown[] = [];
  const stopA = client.subscribe(() => seenA.push(client.getSnapshot()));
  const stopB = client.subscribe(() => seenB.push(client.getSnapshot()));
  try {
    const pendingA = client.refresh(), pendingB = client.refresh();
    incoming.resolve(response(ready()));
    await Promise.all([pendingA, pendingB]);
    expect(calls).toBe(1);
    expect(client.getSnapshot().snapshot).toEqual(first);
    expect(seenA).toHaveLength(1);
    expect(seenB[0]).toBe(seenA[0]);
    expect(client.getSnapshot()).toBe(seenA[0]);
    expect(() => { client.getSnapshot().snapshot!.value = 0; }).toThrow();
    expect(client.getSnapshot().snapshot!.value).toBe(5000);
  } finally { stopA(); stopB(); }
});

test('a new revision reaches both consumers and a failed refresh retains its evidence', async () => {
  let result = response(ready());
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => result, now: () => Date.parse('2026-10-28T08:00:00Z') });
  const seenA: unknown[] = [], seenB: unknown[] = [];
  const stopA = client.subscribe(() => seenA.push(client.getSnapshot()));
  const stopB = client.subscribe(() => seenB.push(client.getSnapshot()));
  try {
    await client.refresh();
    result = response(ready(second, 'eia-two'));
    await client.refresh();
    const published = client.getSnapshot();
    expect(published.revision).toBe('eia-two');
    expect(published.snapshot).toEqual(second);
    expect(seenA.at(-1)).toBe(seenB.at(-1));
    result = new Response('secret or upstream diagnostics', { status: 503 });
    await client.refresh();
    const failed = client.getSnapshot();
    expect(failed.status).toBe('stale');
    expect(failed.revision).toBe('eia-two');
    expect(failed.snapshot).toBe(published.snapshot);
    expect(failed.snapshot).toEqual(second);
    expect(seenA.at(-1)).toBe(seenB.at(-1));
    expect(failed.lastAttemptAt).toBe('2026-10-28T08:00:00.000Z');
    expect(failed.error).not.toContain('secret');
  } finally { stopA(); stopB(); }
});

test('an unchanged revision keeps snapshot identity while server status can change', async () => {
  let result = ready();
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => response(result) });
  await client.refresh();
  const snapshot = client.getSnapshot().snapshot;
  result = { ...result, status: 'stale', lastAttemptAt: '2026-10-28T08:00:00Z' };
  await client.refresh();
  expect(client.getSnapshot().status).toBe('stale');
  expect(client.getSnapshot().snapshot).toBe(snapshot);
  expect(client.getSnapshot().lastAttemptAt).toBe('2026-10-28T08:00:00Z');
});

test('a restarted unavailable server cannot erase a consumer\'s last successful revision', async () => {
  let result: unknown = ready();
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => response(result) });
  await client.refresh();
  result = { status: 'unavailable', snapshot: null, revision: null, lastAttemptAt: '2026-10-28T08:00:00Z', nextRefreshAt: null };
  await client.refresh();
  expect(client.getSnapshot()).toMatchObject({ status: 'stale', revision: 'eia-one', snapshot: first, loading: false });
});

test('no successful reading stays unavailable without invented data', async () => {
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => { throw new Error('request secret'); } });
  await client.refresh();
  expect(client.getSnapshot()).toMatchObject({ status: 'unavailable', revision: null, snapshot: null, loading: false });
  expect(client.getSnapshot().error).not.toContain('secret');
});

test('malformed publication metadata cannot replace a successful reading', async () => {
  let result: unknown = ready();
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => response(result) });
  await client.refresh();
  result = { ...ready(second), revision: null };
  await client.refresh();
  expect(client.getSnapshot()).toMatchObject({ status: 'stale', revision: 'eia-one', snapshot: first });
});

test('polling continues for the remaining consumer and stops after the last leaves', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => { calls++; return response(ready()); }, pollMs: 1000 });
  const stopA = client.subscribe(() => {}), stopB = client.subscribe(() => {});
  await client.refresh();
  stopA();
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(2);
  stopB();
  await vi.advanceTimersByTimeAsync(3000);
  expect(calls).toBe(2);
});

test('a cancelled old request cannot replace data from a remounted consumer', async () => {
  const old = deferred<Response>();
  let calls = 0;
  let oldSignal: AbortSignal | null | undefined;
  const client = createFeedClient<Reading>('/eia', { fetcher: async (_url, init) => {
    if (++calls === 1) { oldSignal = init?.signal; return old.promise; }
    return response(ready(second, 'eia-two'));
  } });
  const leave = client.subscribe(() => {});
  const oldRefresh = client.refresh();
  leave();
  const leaveAgain = client.subscribe(() => {});
  try {
    await client.refresh();
    await oldRefresh;
    old.resolve(response(ready()));
    expect(oldSignal?.aborted).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ revision: 'eia-two', snapshot: second });
  } finally { leaveAgain(); }
});



test('one broken consumer cannot turn a successful request into failure or prevent another consumer updating', async () => {
  const failure = new Error('Broken view');
  const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
  const client = createFeedClient<Reading>('/eia', { fetcher: async () => response(ready()) });
  let received: unknown;
  const stopBroken = client.subscribe(() => { throw failure; });
  const stopHealthy = client.subscribe(() => { received = client.getSnapshot(); });
  try {
    await expect(client.refresh()).resolves.toBeUndefined();
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', snapshot: first, revision: 'eia-one' });
    expect(received).toBe(client.getSnapshot());
    expect(reported).toHaveBeenCalledWith('Feed subscriber failed.', failure);
  } finally { stopBroken(); stopHealthy(); reported.mockRestore(); }
});

function recoveryClock() {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-28T08:00:00Z');
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
}

test.each([429, 500, 502, 503, 504])('HTTP %i recovers promptly for shared consumers without replacing evidence during failure', async status => {
  recoveryClock();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(ready()))
    .mockResolvedValueOnce(new Response(null, { status }))
    .mockImplementation(async () => response(ready(second, 'eia-two')));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leaveA = client.subscribe(() => {}), leaveB = client.subscribe(() => {});
  try {
    await client.refresh();
    const retained = client.getSnapshot().snapshot;
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'stale', revision: 'eia-one', loading: false });
    expect(client.getSnapshot().snapshot).toBe(retained);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', revision: 'eia-two', snapshot: second });
  } finally { leaveA(); leaveB(); }
});

test.each(['70', 'Wed, 28 Oct 2026 08:01:10 GMT'])('Retry-After %s prevents polling and manual refresh from sending early requests', async retryAfter => {
  recoveryClock();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }))
    .mockImplementation(async () => response(ready()));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'unavailable', snapshot: null, revision: null, loading: false });
    await vi.advanceTimersByTimeAsync(60_000);
    await client.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().status).toBe('ready');
  } finally { leave(); }
});

test('three quick retries exhaust the network recovery burst, then ordinary polling resumes', async () => {
  recoveryClock();
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network offline'));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    await client.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(client.getSnapshot()).toMatchObject({ status: 'unavailable', snapshot: null, revision: null, loading: false });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  } finally { leave(); }
});

test.each([0, 1])('quick retry delay is jittered within the one-second backoff window (random %i)', async random => {
  recoveryClock();
  vi.mocked(Math.random).mockReturnValue(random);
  const fetcher = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Network offline'))
    .mockImplementation(async () => response(ready()));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    await client.refresh();
    const delay = random === 0 ? 750 : 1250;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().status).toBe('ready');
  } finally { leave(); }
});

test('a 15-second deadline aborts a stuck request, retains real evidence, and permits recovery', async () => {
  recoveryClock();
  const stalled = deferred<Response>();
  let stalledSignal: AbortSignal | null | undefined;
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(ready()))
    .mockImplementationOnce(async (_url, init) => { stalledSignal = init?.signal; return stalled.promise; })
    .mockImplementation(async () => response(ready(second, 'eia-two')));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    await client.refresh();
    const retained = client.getSnapshot().snapshot;
    let settled = false;
    const pending = client.refresh().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(stalledSignal?.aborted).toBe(false);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stalledSignal?.aborted).toBe(true);
    expect(settled).toBe(true);
    await pending;
    expect(client.getSnapshot()).toMatchObject({ status: 'stale', revision: 'eia-one', loading: false });
    expect(client.getSnapshot().snapshot).toBe(retained);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', revision: 'eia-two' });
    stalled.resolve(response(ready()));
    await Promise.resolve();
    expect(client.getSnapshot().revision).toBe('eia-two');
  } finally { leave(); }
});

test('the deadline also covers a response whose body never finishes', async () => {
  recoveryClock();
  const body = deferred<unknown>();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: () => body.promise } as Response);
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    const pending = client.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(client.getSnapshot()).toMatchObject({ status: 'unavailable', snapshot: null, loading: false });
    await pending;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally { leave(); }
});

test('the last departure cancels a pending retry and a remount starts only one fresh request', async () => {
  recoveryClock();
  const fetcher = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Network offline'))
    .mockImplementation(async () => response(ready()));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leaveA = client.subscribe(() => {}), leaveB = client.subscribe(() => {});
  await client.refresh();
  leaveA();
  expect(vi.getTimerCount()).toBe(1);
  leaveB();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(70_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const leaveAgain = client.subscribe(() => {});
  try {
    await client.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().status).toBe('ready');
  } finally { leaveAgain(); }
});

test('unsubscribing during a hung request is silent and cancels the deadline', async () => {
  recoveryClock();
  const stalled = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => stalled.promise);
  const listener = vi.fn();
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const initial = client.getSnapshot();
  const leave = client.subscribe(listener);
  const pending = client.refresh();
  leave();
  await pending;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(70_000);
  expect(listener).not.toHaveBeenCalled();
  expect(client.getSnapshot()).toBe(initial);
});

test.each([
  ['permanent HTTP 404', () => new Response(null, { status: 404 })],
  ['invalid JSON', () => new Response('{')],
  ['invalid publication metadata', () => response({ ...ready(second), revision: null })],
] as const)('%s preserves evidence and waits for ordinary polling', async (_label, failure) => {
  recoveryClock();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(ready()))
    .mockImplementationOnce(async () => failure())
    .mockImplementation(async () => response(ready(second, 'eia-two')));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    await client.refresh();
    const retained = client.getSnapshot().snapshot;
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'stale', revision: 'eia-one' });
    expect(client.getSnapshot().snapshot).toBe(retained);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(client.getSnapshot().revision).toBe('eia-two');
  } finally { leave(); }
});

test('a refresh without subscribers reports failure but does not start background retries', async () => {
  recoveryClock();
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network offline'));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  await client.refresh();
  expect(client.getSnapshot()).toMatchObject({ status: 'unavailable', snapshot: null, loading: false });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(70_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});


test.each([0, 1])('Retry-After retains jitter so recovering clients do not all restart together (random %i)', async random => {
  recoveryClock();
  vi.mocked(Math.random).mockReturnValue(random);
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '70' } }))
    .mockImplementation(async () => response(ready()));
  const client = createFeedClient<Reading>('/eia', { fetcher });
  const leave = client.subscribe(() => {});
  try {
    await client.refresh();
    const delay = random === 0 ? 70_750 : 71_250;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().status).toBe('ready');
  } finally { leave(); }
});
