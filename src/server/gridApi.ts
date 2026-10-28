import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { createCachedFeed, FeedError } from './cachedFeed.ts';
import { collectEiaPublication } from './eia.ts';
import { collectCaisoPublication } from './caiso.ts';
import { createSnapshotArchive, type SourceEvidence } from './snapshotArchive.ts';

/** Server-only credentials and archives. Browsers receive normalized facts only. */
export function createGridApi(apiKey: string, offline = false, options: {
  archiveDirectory?: string; fetcher?: typeof fetch; now?: () => number;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const directory = resolve(options.archiveDirectory ?? process.env.GRID_SNAPSHOT_DIR ?? '.cache/grid');
  function savedFeed<T>(name: string, source: () => Promise<{ snapshot: T; evidence: SourceEvidence }>, refreshMs: number) {
    const archive = createSnapshotArchive<T>(directory, name);
    const cache = createCachedFeed(async () => {
      if (offline) throw new FeedError('External feeds are disabled in this test server.');
      const collected = await source();
      try { await archive.save(collected.snapshot, collected.evidence); }
      catch { throw new FeedError('The collected snapshot could not be saved; no new revision was published.'); }
      return collected.snapshot;
    }, refreshMs, now, offline ? undefined : async () => (await archive.latest())?.snapshot ?? null);
    return { cache, archive };
  }
  const eia = savedFeed('eia', () => collectEiaPublication(apiKey, fetcher, now), 15 * 60_000);
  const caiso = savedFeed('caiso', () => collectCaisoPublication(fetcher, now), 5 * 60_000);
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
