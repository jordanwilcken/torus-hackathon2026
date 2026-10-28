import type { IncomingMessage, ServerResponse } from 'node:http';
import { createGridFeeds, type GridFeeds, type GridFeedOptions, type GridSnapshotStores } from './gridFeeds.ts';
import { snapshotRevision } from './snapshotRevision.ts';
export type { GridSnapshotStores } from './gridFeeds.ts';

/** Server-only credentials and archives. Browsers receive normalized facts only. */
export function createGridApi(apiKey: string, stores: GridSnapshotStores, options: GridFeedOptions & { feeds?: GridFeeds } = {}) {
  const feeds = options.feeds ?? createGridFeeds(apiKey, stores, options);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { send(response, 400, { error: 'Invalid grid request.' }); return; }
    const name = url.pathname === '/api/grid/eia' ? 'eia' : url.pathname === '/api/grid/caiso' ? 'caiso' : undefined;
    if (!name) { next(); return; }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
    const revisions = url.searchParams.getAll('revision');
    if (revisions.length) {
      if (revisions.length !== 1 || !/^[a-f0-9]{64}$/.test(revisions[0])) {
        send(response, 400, { error: 'A revision must be one lowercase SHA-256 identifier.' }); return;
      }
      if (options.offline) { send(response, 503, { error: 'Archives are disabled in this test server.' }); return; }
      void stores[name].read(revisions[0]).then(record => {
        if (!record) { send(response, 404, { error: 'Saved revision not found.' }); return; }
        if (record.revision !== revisions[0] || record.revision !== snapshotRevision(record.snapshot)) throw new Error('Store returned a different revision');
        send(response, 200, { archived: true, revision: record.revision, snapshot: record.snapshot });
      }).catch(() => send(response, 503, { error: 'Saved revision could not be read or verified.' }));
      return;
    }
    void feeds[name].read().then(state => send(response, 200, state))
      .catch(() => send(response, 503, { error: 'Grid feed unavailable.' }));
  };
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
