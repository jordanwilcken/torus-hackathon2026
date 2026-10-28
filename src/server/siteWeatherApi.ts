import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SiteWeatherFeed } from './siteWeather.ts';

export function createSiteWeatherApi(feed: SiteWeatherFeed) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let path: string;
    try { path = new URL(request.url ?? '/', 'http://localhost').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    if (path !== '/api/weather/sites') { next(); return; }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    void feed.read().then(state => send(200, state))
      .catch(() => send(503, { error: 'Site weather could not be read or verified.' }));
  };
}
