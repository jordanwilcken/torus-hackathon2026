import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SiteWeatherFeed } from './siteWeather.ts';
import type { SiteWeatherSnapshot } from '../data/SiteWeather.type.ts';
import type { SnapshotHistoryStore } from './SnapshotStore.type.ts';
import { createSiteWeatherHistory, decisionTime, weatherRevision, WeatherHistoryError } from './siteWeatherHistory.ts';

export function createSiteWeatherApi(feed: SiteWeatherFeed, archive?: SnapshotHistoryStore<SiteWeatherSnapshot>) {
  const history = archive && createSiteWeatherHistory(archive);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { response.writeHead(400); response.end(); return; }
    const path = url.pathname;
    if (!['/api/weather/sites','/api/weather/revisions','/api/weather/replay','/api/weather/compare'].includes(path)) { next(); return; }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    void (async () => {
      if (path === '/api/weather/sites') return feed.read();
      if (!history) throw new WeatherHistoryError(503, 'Weather history is not configured.');
      if (path === '/api/weather/revisions') return history.list();
      const query = url.searchParams;
      if (path === '/api/weather/replay') return history.replay(decisionTime(query.get('at')),
        query.has('revision') ? weatherRevision(query.get('revision')) : undefined,
        query.has('selection') ? weatherRevision(query.get('selection')) : undefined);
      return history.compare(weatherRevision(query.get('earlier')),weatherRevision(query.get('later')),query.get('site') ?? '');
    })().then(state => send(200, state))
      .catch(error => send(error instanceof WeatherHistoryError ? error.status : 503,
        { error:error instanceof WeatherHistoryError ? error.message : 'Site weather could not be read or verified.' }));
  };
}
