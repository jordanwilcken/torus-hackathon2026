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
afterEach(() => vi.useRealTimers());

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
