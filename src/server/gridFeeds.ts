import { publicFeedCadence } from '../data/publicFeedCadence.ts';
import { createCachedFeed, FeedError } from './cachedFeed.ts';
import { collectEiaPublication } from './eia.ts';
import { collectCaisoPublication, type CaisoSnapshot } from './caiso.ts';
import type { EiaApiSnapshot } from '../core/energy/data/eiaApi.ts';
import type { FeedState } from '../data/FeedState.type.ts';
import type { SnapshotStore, SourceEvidence } from './SnapshotStore.type.ts';
import { snapshotRevision } from './snapshotRevision.ts';

export type GridSnapshotStores = { eia: SnapshotStore<EiaApiSnapshot>; caiso: SnapshotStore<CaisoSnapshot> };
export type GridFeeds = {
  eia: { read(): Promise<FeedState<EiaApiSnapshot>> };
  caiso: { read(): Promise<FeedState<CaisoSnapshot>> };
};
export type GridFeedOptions = { offline?: boolean; fetcher?: typeof fetch; now?: () => number };

export function createGridFeeds(apiKey: string, stores: GridSnapshotStores, options: GridFeedOptions = {}): GridFeeds {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  function feed<T extends { retrievedAt: string }>(archive: SnapshotStore<T>, source: () => Promise<{ snapshot: T; evidence: SourceEvidence }>, refreshMs: number) {
    return createCachedFeed(async () => {
      if (options.offline) throw new FeedError('External feeds are disabled in this test server.');
      const collected = await source();
      try {
        if (await archive.save(collected.snapshot, collected.evidence) !== snapshotRevision(collected.snapshot)) throw new Error('Mismatched stored revision');
      } catch { throw new FeedError('The collected snapshot could not be saved; no new revision was published.'); }
      return collected.snapshot;
    }, refreshMs, now, options.offline ? undefined : async () => {
      const record = await archive.latest();
      if (record && record.revision !== snapshotRevision(record.snapshot)) throw new Error('Store returned an invalid revision');
      return record?.snapshot ?? null;
    }, snapshot => Date.parse(snapshot.retrievedAt));
  }
  return {
    eia: feed(stores.eia, () => collectEiaPublication(apiKey, fetcher, now), publicFeedCadence.eia),
    caiso: feed(stores.caiso, () => collectCaisoPublication(fetcher, now), publicFeedCadence.market),
  };
}

/** Explicit historical replay: no changed timestamps and no upstream collection. */
export function createRecordedGridFeeds(stores: GridSnapshotStores): GridFeeds {
  function feed<T>(store: SnapshotStore<T>) {
    return { async read(): Promise<FeedState<T>> {
      const record = await store.latest();
      if (record && record.revision !== snapshotRevision(record.snapshot)) throw new Error('Recorded revision mismatch');
      return { status: record ? 'ready' : 'unavailable', snapshot: record?.snapshot ?? null,
        revision: record?.revision ?? null, lastAttemptAt: null, nextRefreshAt: null };
    } };
  }
  return { eia: feed(stores.eia), caiso: feed(stores.caiso) };
}
