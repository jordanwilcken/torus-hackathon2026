import { afterEach, expect, test, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import captured from '../../../fixtures/weather/open-meteo.json';
import type { SiteWeatherSnapshot } from '../../../../src/data/SiteWeather.type';
import { createSnapshotArchive } from '../../../../src/server/snapshotArchive';
import { parseSiteWeatherResponse } from '../../../../src/server/siteWeather';
import { createSiteWeatherApi } from '../../../../src/server/siteWeatherApi';

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('weather-history-')) throw new Error('Unowned directory');
    await rm(directory, { recursive: true, force: true });
  }
});

async function scenario() {
  const directory = await mkdtemp(join(tmpdir(), 'weather-history-'));
  directories.push(directory);
  const archive = createSnapshotArchive<SiteWeatherSnapshot>(directory, 'open-meteo');
  const first = parseSiteWeatherResponse(captured.response, '2026-10-28T16:00:00Z');
  const second = structuredClone(first);
  second.retrievedAt = '2026-10-28T17:00:00.000Z';
  second.sites[0].intervals[16].shortwaveRadiationWm2 = 300;
  second.sites[0].intervals[17].shortwaveRadiationWm2 = null;
  const evidence = { format: 'declared-test-example', body: { sourceUrl:captured.sourceUrl } };
  const earlier = await archive.save(first, evidence);
  const later = await archive.save(second, evidence);
  const read = vi.fn(async () => ({status: 'unavailable' as const, snapshot: null, revision: null, lastAttemptAt: null, nextRefreshAt: null}));
  const api = createSiteWeatherApi({ read }, createSnapshotArchive<SiteWeatherSnapshot>(directory, 'open-meteo'));
  const server = createServer((request, response) => api(request, response, () => {response.writeHead(404); response.end();}));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return { base, earlier, later, first, read, archive };
}

test('saved weather revisions remain inspectable after restarting the archive without collecting again', async () => {
  const { base, earlier, later, read } = await scenario();
  const response = await fetch(base + '/api/weather/revisions');
  expect(response.status).toBe(200);
  const history = await response.json();
  expect(history.revisions.map((entry: {revision:string}) => entry.revision)).toEqual([later, earlier]);
  expect(history.revisions[0]).toMatchObject({ sourceKind:'forecast', model:'best_match', issuedAt:null, forecastDays:2, retrievedAt:'2026-10-28T17:00:00.000Z' });
  expect(read).not.toHaveBeenCalled();
});

test('replay pins the last forecast retrieved by the decision time and rejects a future revision', async () => {
  const { base, earlier, later, first, read } = await scenario();
  const response = await fetch(base + '/api/weather/replay?at=2026-10-28T16:30:00Z');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ revision:earlier, snapshot:first, basis:'retrieved-by-decision-time' });
  expect((await fetch(base + `/api/weather/replay?at=2026-10-28T16:30:00Z&revision=${later}`)).status).toBe(409);
  expect((await fetch(base + '/api/weather/replay?at=2026-10-28T15:00:00Z')).status).toBe(404);
  expect(read).not.toHaveBeenCalled();
});

test('comparison uses the same city and common intervals, retaining missing radiation instead of inventing zero', async () => {
  const {base, earlier, later, read} = await scenario();
  const response = await fetch(base + `/api/weather/compare?earlier=${earlier}&later=${later}&site=A`);
  expect(response.status).toBe(200);
  const comparison = await response.json();
  expect(comparison).toMatchObject({basis:'forecast-revision-change',unit:'W/m²',temporalBasis:'preceding-hour-average',site:{locationId:'A',latitude:40.7608,longitude:-111.891}});
  expect(comparison.points[16]).toMatchObject({earlier:254,later:300,change:46});
  expect(comparison.points[17]).toMatchObject({later:null,change:null});
  expect((await fetch(base + `/api/weather/compare?earlier=${earlier}&later=${later}&site=missing`)).status).toBe(404);
  expect((await fetch(base + `/api/weather/compare?earlier=${later}&later=${earlier}&site=A`)).status).toBe(409);
  expect(read).not.toHaveBeenCalled();
});

test('invalid replay requests and non-read methods never trigger a provider request', async () => {
  const {base,read} = await scenario();
  expect((await fetch(base + '/api/weather/replay?at=yesterday')).status).toBe(400);
  expect((await fetch(base + '/api/weather/replay?at=2026-10-28T16:30:00Z&revision=bad')).status).toBe(400);
  expect((await fetch(base + '/api/weather/revisions', {method:'POST'})).status).toBe(405);
  expect(read).not.toHaveBeenCalled();
});

test('different saved weather selections require an explicit replay identity and moved coordinates cannot be compared', async () => {
  const {base,archive,earlier,first} = await scenario();
  const moved = structuredClone(first);
  moved.retrievedAt = '2026-10-28T18:00:00.000Z';
  moved.sites[0].latitude = 41;
  const changed = await archive.save(moved,{format:'declared-test-example',body:{}});
  expect((await fetch(base+'/api/weather/replay?at=2026-10-28T19:00:00Z')).status).toBe(409);
  const replay = await fetch(base+`/api/weather/replay?at=2026-10-28T19:00:00Z&revision=${earlier}`);
  expect(replay.status).toBe(200);
  expect((await replay.json()).snapshot).toEqual(first);
  expect((await fetch(base+`/api/weather/compare?earlier=${earlier}&later=${changed}&site=A`)).status).toBe(409);
});
