import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCachedFeed, FeedError } from './cachedFeed.ts';
import { collectEiaSnapshot } from './eia.ts';
import { collectCaisoPrices } from './caiso.ts';

/** Server-only credentials and upstream clients. Browsers receive normalized facts only. */
export function createGridApi(apiKey: string, offline = false) {
  const collect = <T>(source: () => Promise<T>): Promise<T> => {
    if (offline) throw new FeedError('External feeds are disabled in this test server.');
    return source();
  };
  const eia = createCachedFeed(() => collect(() => collectEiaSnapshot(apiKey)), 15 * 60_000);
  const caiso = createCachedFeed(() => collect(() => collectCaisoPrices()), 5 * 60_000);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url?.split('?')[0];
    const feed = path === '/api/grid/eia' ? eia : path === '/api/grid/caiso' ? caiso : undefined;
    if (!feed) { next(); return; }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }); response.end(); return;
    }
    void feed.read().then(state => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(state));
    }).catch(() => {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Grid feed unavailable.' }));
    });
  };
}
