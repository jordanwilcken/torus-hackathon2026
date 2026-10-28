import { expect, test } from 'vitest';
import { createCachedFeed, FeedError } from '../../../../src/server/cachedFeed';

test('concurrent readers share a refresh and cannot mutate the cached snapshot', async () => {
  let calls = 0;
  let finish!: (value: { observedAt: string; value: number }) => void;
  const pending = new Promise<{ observedAt: string; value: number }>(resolve => { finish = resolve; });
  const feed = createCachedFeed(() => { calls++; return pending; }, 900_000, () => 0);
  const results = Promise.all([feed.read(), feed.read()]);
  finish({ observedAt: '2026-10-28T07:00:00Z', value: 5429 });
  const [a, b] = await results;
  expect(a.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(b.revision).toBe(a.revision);
  a.snapshot!.value = 0;
  expect(b.snapshot).toEqual({ observedAt: '2026-10-28T07:00:00Z', value: 5429 });
  const cached = await feed.read();
  expect(cached.status).toBe('ready');
  expect(cached.revision).toBe(b.revision);
  expect(calls).toBe(1);
});

test('a failed refresh retains the original reading and waits before retrying', async () => {
  let time = 0;
  let calls = 0;
  const feed = createCachedFeed(async () => {
    if (++calls > 1) throw new FeedError('EIA rate limited the request.', 600_000);
    return { retrievedAt: '2026-10-28T08:00:00Z', value: 5429 };
  }, 900_000, () => time);
  const initial = await feed.read();
  time = 900_000;
  const failed = await feed.read();
  expect(failed.status).toBe('stale');
  expect(failed.snapshot).toEqual(initial.snapshot);
  expect(failed.revision).toBe(initial.revision);
  expect(failed.nextRefreshAt).toBe(new Date(1_500_000).toISOString());
  time = 1_000_000;
  await feed.read();
  expect(calls).toBe(2);
});

test('an initial failure stays unavailable and never exposes a request URL or credential', async () => {
  const feed = createCachedFeed(async () => { throw new Error('https://api.eia.gov/?api_key=secret-fixture'); }, 900_000);
  const result = await feed.read();
  expect(result.status).toBe('unavailable');
  expect(result.snapshot).toBeNull();
  expect(result.revision).toBeNull();
  expect(JSON.stringify(result)).not.toContain('secret-fixture');
});

test('revision identifies the published snapshot content across consumers and changes with new data', async () => {
  let time = 0;
  let value = 5429;
  const collect = async () => ({ retrievedAt: '2026-10-28T08:00:00Z', value });
  const feed = createCachedFeed(collect, 900_000, () => time);
  const first = await feed.read();
  // Independently calculated SHA-256 for {"retrievedAt":"2026-10-28T08:00:00Z","value":5429}.
  expect(first.revision).toBe('7b046b7111e429cae6e07609f49d9d07e39726881e5f04c8f3ec87e3b15cb79f');
  const otherConsumer = await createCachedFeed(collect, 900_000, () => time).read();
  expect(otherConsumer.revision).toBe(first.revision);

  time = 900_000;
  const identicalPublication = await feed.read();
  expect(identicalPublication.revision).toBe(first.revision);
  value = 5500;
  time = 1_800_000;
  const changedPublication = await feed.read();
  expect(changedPublication.snapshot?.value).toBe(5500);
  expect(changedPublication.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(changedPublication.revision).not.toBe(first.revision);
});

test('collector-owned mutations cannot change a published snapshot or its revision', async () => {
  const owned = { observations: [{ value: 5429 }] };
  const feed = createCachedFeed(async () => owned, 900_000, () => 0);
  const published = await feed.read();
  owned.observations[0].value = 0;
  owned.observations.push({ value: 99 });

  const nextReader = await feed.read();
  expect(nextReader.snapshot).toEqual({ observations: [{ value: 5429 }] });
  expect(nextReader.revision).toBe(published.revision);
});

test('an empty collection never creates a publication revision', async () => {
  const feed = createCachedFeed(async () => null, 900_000, () => 0);
  const result = await feed.read();
  expect(result.status).toBe('unavailable');
  expect(result.snapshot).toBeNull();
  expect(result.revision).toBeNull();
});

test('a new cache restores the saved revision before a failed live refresh without changing evidence times', async () => {
  const snapshot = { retrievedAt: '2026-10-28T08:00:00Z', value: 5429 };
  let restores = 0;
  let collections = 0;
  const feed = createCachedFeed(async () => { collections++; throw new FeedError('Network unavailable.'); },
    900_000, () => Date.parse('2026-10-28T09:00:00Z'), async () => { restores++; return snapshot; });
  const [first, second] = await Promise.all([feed.read(), feed.read()]);
  expect(first.status).toBe('stale');
  expect(first.snapshot).toEqual(snapshot);
  expect(first.revision).toBe('7b046b7111e429cae6e07609f49d9d07e39726881e5f04c8f3ec87e3b15cb79f');
  expect(second.revision).toBe(first.revision);
  expect(first.lastAttemptAt).toBe('2026-10-28T09:00:00.000Z');
  expect(restores).toBe(1);
  expect(collections).toBe(1);
});

test('corrupt saved evidence is reported safely when live collection is also unavailable', async () => {
  const feed = createCachedFeed(async () => { throw new FeedError('Network unavailable.'); }, 900_000, () => 0,
    async () => { throw new Error('Private archive path with secret-fixture'); });
  const result = await feed.read();
  expect(result.status).toBe('unavailable');
  expect(result.snapshot).toBeNull();
  expect(result.revision).toBeNull();
  expect(result.error).toContain('Saved snapshot could not be loaded.');
  expect(result.error).not.toContain('secret-fixture');
});

test('a successful live refresh replaces restored evidence and clears a restore failure', async () => {
  const snapshot = { retrievedAt: '2026-10-28T09:00:00Z', value: 5500 };
  let restores = 0;
  const feed = createCachedFeed(async () => snapshot, 900_000, () => 0,
    async () => { restores++; throw new Error('Corrupt saved data'); });
  const result = await feed.read();
  expect(restores).toBe(1);
  expect(result).toMatchObject({ status: 'ready', snapshot });
  expect(result.error).toBeUndefined();
});
