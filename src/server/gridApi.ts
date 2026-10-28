import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCachedFeed, FeedError } from './cachedFeed.ts';
import { collectEiaPublication } from './eia.ts';
import { collectCaisoPublication } from './caiso.ts';
import type { SnapshotStore, SourceEvidence } from './SnapshotStore.type.ts';
import type { EiaApiSnapshot } from '../core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from './caiso.ts';
import { snapshotRevision } from './snapshotRevision.ts';

export type GridSnapshotStores = {
  eia: SnapshotStore<EiaApiSnapshot>;
  caiso: SnapshotStore<CaisoSnapshot>;
};

/** Server-only credentials and archives. Browsers receive normalized facts only. */
export function createGridApi(apiKey: string, stores: GridSnapshotStores, options: {
  offline?: boolean; fetcher?: typeof fetch; now?: () => number;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const offline = options.offline ?? false;
  function savedFeed<T>(archive: SnapshotStore<T>, source: () => Promise<{ snapshot: T; evidence: SourceEvidence }>, refreshMs: number) {
    const cache = createCachedFeed(async () => {
      if (offline) throw new FeedError('External feeds are disabled in this test server.');
      const collected = await source();
      try {
        const saved = await archive.save(collected.snapshot, collected.evidence);
        if (saved !== snapshotRevision(collected.snapshot)) throw new Error('Store returned a different revision');
      }
      catch { throw new FeedError('The collected snapshot could not be saved; no new revision was published.'); }
      return collected.snapshot;
    }, refreshMs, now, offline ? undefined : async () => {
      const record = await archive.latest();
      if (record && record.revision !== snapshotRevision(record.snapshot)) throw new Error('Store returned an invalid revision');
      return record?.snapshot ?? null;
    });
    return { cache, archive };
  }
  const eia = savedFeed(stores.eia, () => collectEiaPublication(apiKey, fetcher, now), 15 * 60_000);
  const caiso = savedFeed(stores.caiso, () => collectCaisoPublication(fetcher, now), 5 * 60_000);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { send(response, 400, { error: 'Invalid grid request.' }); return; }
    const feed = url.pathname === '/api/grid/eia' ? eia : url.pathname === '/api/grid/caiso' ? caiso : undefined;
    if (!feed) { next(); return; }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }); response.end(); return;
    }
    const revisions = url.searchParams.getAll('revision');
    if (revisions.length) {
      if (revisions.length !== 1 || !/^[a-f0-9]{64}$/.test(revisions[0])) {
        send(response, 400, { error: 'A revision must be one lowercase SHA-256 identifier.' }); return;
      }
      if (offline) { send(response, 503, { error: 'Archives are disabled in this test server.' }); return; }
      void feed.archive.read(revisions[0]).then(record => {
        if (!record) { send(response, 404, { error: 'Saved revision not found.' }); return; }
        if (record.revision !== revisions[0] || record.revision !== snapshotRevision(record.snapshot)) throw new Error('Store returned a different revision');
        send(response, 200, { archived: true, revision: record.revision, snapshot: record.snapshot });
      }).catch(() => send(response, 503, { error: 'Saved revision could not be read or verified.' }));
      return;
    }
    void feed.cache.read().then(state => send(response, 200, state))
      .catch(() => send(response, 503, { error: 'Grid feed unavailable.' }));
  };
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
