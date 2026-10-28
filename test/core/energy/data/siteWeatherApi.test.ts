import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import captured from '../../../fixtures/weather/open-meteo.json';
import type { SiteWeatherSnapshot } from '../../../../src/data/SiteWeather.type';
import type { FeedState } from '../../../../src/data/FeedState.type';
import type { SnapshotStore } from '../../../../src/server/SnapshotStore.type';
import { createSnapshotArchive } from '../../../../src/server/snapshotArchive';
import { createSiteWeatherFeed, type SiteWeatherOptions } from '../../../../src/server/siteWeather';
import { createSiteWeatherApi } from '../../../../src/server/siteWeatherApi';
import { createSiteWeatherClient } from '../../../../src/data/createSiteWeatherClient';

let directory: string;
let servers: Server[];
let at: number;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sunchaser-weather-'));
  servers = [];
  at = Date.parse(captured.retrievedAt);
  fetcher = vi.fn<typeof fetch>(async () => Response.json(captured.response));
});
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('sunchaser-weather-'))
    throw new Error('Refusing to remove an unowned directory');
  await rm(directory, { recursive: true, force: true });
});
function archive() { return createSnapshotArchive<SiteWeatherSnapshot>(directory, 'open-meteo'); }
async function application(store: SnapshotStore<SiteWeatherSnapshot> = archive(), options: SiteWeatherOptions = {}) {
  const api = createSiteWeatherApi(createSiteWeatherFeed(store, { fetcher, now: () => at, ...options }));
  const server = createServer((request, response) => api(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function publication(base: string): Promise<FeedState<SiteWeatherSnapshot>> {
  const response = await fetch(base + '/api/weather/sites');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response.json();
}

test('HTTP consumers and the browser client receive one archived, per-city publication from a single coordinate request', async () => {
  const base = await application();
  const [first, concurrent] = await Promise.all([publication(base), publication(base)]);
  expect(first).toEqual(concurrent);
  expect(first.status).toBe('ready');
  expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(first.snapshot?.sites.map(site => site.intervals[16].shortwaveRadiationWm2)).toEqual([254, 279, 124, 425, 350, 415]);
  const record = await archive().read(first.revision!);
  expect(record).toMatchObject({ snapshot: first.snapshot, revision: first.revision, evidence: { format: 'open-meteo-response-v1' } });
  expect((record?.evidence.body as { response: unknown }).response).toEqual(captured.response);
  const request = new URL(String(fetcher.mock.calls[0][0]));
  expect(request.origin + request.pathname).toBe('https://api.open-meteo.com/v1/forecast');
  expect(Object.fromEntries(request.searchParams)).toEqual({
    latitude: '40.7608,37.6775,38.5816,30.2672,39.7392,37.5407',
    longitude: '-111.891,-113.0619,-121.4944,-97.7431,-104.9903,-77.436',
    hourly: 'shortwave_radiation', forecast_days: '3', timezone: 'UTC',
  });
  const client = createSiteWeatherClient({ fetcher: (input, init) => fetch(new URL(String(input), base), init) });
  await client.refresh();
  expect(client.getSnapshot()).toEqual({ ...first, loading: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
  at += 30 * 60_000 - 1;
  expect(await publication(base)).toEqual(first);
  expect(fetcher).toHaveBeenCalledTimes(1);
  at++;
  const refreshed = await publication(base);
  expect(refreshed.revision).not.toBe(first.revision);
  expect(refreshed.snapshot?.retrievedAt).toBe('2026-10-28T16:51:26.334Z');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a restarted feed restores the exact archived weather and exposes staleness when the provider fails', async () => {
  const first = await publication(await application());
  at += 30 * 60_000;
  fetcher.mockRejectedValue(new Error('Private network diagnostic'));
  const restarted = await publication(await application());
  expect(restarted).toMatchObject({ status: 'stale', revision: first.revision, snapshot: first.snapshot,
    error: 'Open-Meteo could not be reached.' });
  expect(JSON.stringify(restarted)).not.toContain('Private network diagnostic');
});

test('failed durable publication retains the previous revision and original retrieval time', async () => {
  const store = archive();
  const base = await application(store);
  const first = await publication(base);
  store.save = async () => { throw new Error('Private storage diagnostic'); };
  at += 30 * 60_000;
  const failed = await publication(base);
  expect(failed).toMatchObject({ status: 'stale', revision: first.revision, snapshot: first.snapshot });
  expect(failed.error).toMatch(/could not be saved/);
  expect((await archive().latest())?.revision).toBe(first.revision);
});

test('offline weather is explicitly unavailable while explicit recorded weather preserves its captured timestamps', async () => {
  const first = await publication(await application());
  fetcher.mockClear();
  const offline = await publication(await application(archive(), { offline: true }));
  expect(offline).toMatchObject({ status: 'unavailable', snapshot: null, revision: null });
  expect(offline.error).toMatch(/disabled.*offline/);
  const recorded = await publication(await application(archive(), { offline: true, recorded: true }));
  expect(recorded).toEqual({ status: 'ready', snapshot: first.snapshot, revision: first.revision,
    lastAttemptAt: null, nextRefreshAt: null });
  expect(fetcher).not.toHaveBeenCalled();
});

test('rate limits defer retry and unsupported HTTP methods cannot trigger collection', async () => {
  fetcher.mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '3600' } }));
  const base = await application();
  expect((await fetch(base + '/api/weather/sites', { method: 'POST' })).status).toBe(405);
  expect((await fetch(base + '/api/weather/unknown')).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
  const limited = await publication(base);
  expect(limited).toMatchObject({ status: 'unavailable', snapshot: null, revision: null,
    nextRefreshAt: '2026-10-28T17:21:26.334Z' });
  at += 30 * 60_000;
  expect(await publication(base)).toEqual(limited);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('a second weather server reuses the archived publication without extending its refresh window', async () => {
  const original = await publication(await application());
  at += 2_000;
  const production = await application();
  const restored = await publication(production);
  expect(restored).toMatchObject({ status: 'ready', snapshot: original.snapshot,
    revision: original.revision, lastAttemptAt: null, nextRefreshAt: '2026-10-28T16:51:26.334Z' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  at = Date.parse('2026-10-28T16:51:26.333Z');
  expect(await publication(production)).toEqual(restored);
  expect(fetcher).toHaveBeenCalledTimes(1);
  at++;
  fetcher.mockRejectedValue(new Error('Provider unavailable'));
  expect(await publication(production)).toMatchObject({ status: 'stale', snapshot: original.snapshot,
    revision: original.revision, lastAttemptAt: '2026-10-28T16:51:26.334Z' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
