import { afterEach, beforeEach, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import weatherEvidence from '../../fixtures/weather/open-meteo.json';
import marketEvidence from '../../fixtures/weather/caiso.json';
import eiaEvidence from '../../fixtures/public-grid/eia.json';
import type { FrozenFleetSnapshot } from '../../../src/data/FrozenFleet.type';
import type { SnapshotStore } from '../../../src/server/SnapshotStore.type';
import { createFleetCaptureApi } from '../../../src/server/fleetCaptureApi';
import { createSnapshotArchive } from '../../../src/server/snapshotArchive';
import { parseSiteWeatherResponse } from '../../../src/server/siteWeather';
import { parseCaisoCsv } from '../../../src/server/caiso';
import { snapshotRevision } from '../../../src/server/snapshotRevision';
import { captureLiveFleet } from '../../../src/data/captureLiveFleet';
import { createPairedReplaySession } from '../../../src/core/execution/replay/createPairedReplaySession';

const capturedAt = '2026-10-28T16:26:19.000Z';
const weather = parseSiteWeatherResponse(weatherEvidence.response, weatherEvidence.retrievedAt);
const market = parseCaisoCsv(marketEvidence.evidence.body.csv, marketEvidence.snapshot.retrievedAt);
const feed = <T,>(snapshot: T) => ({ status: 'ready' as const, snapshot, revision: snapshotRevision(snapshot), lastAttemptAt: capturedAt, nextRefreshAt: null });
const capture = captureLiveFleet(feed(weather), feed(market), Date.parse(capturedAt));
if (!capture.available) throw new Error(capture.reason);
const replay = createPairedReplaySession(capture.capture.scenario);
const { map: _map, ...progress } = await replay.step();
const sourceBundle = {
  capturedAt,
  weather: { status: 'ready' as const, revision: snapshotRevision(weather), snapshot: weather },
  caiso: { status: 'ready' as const, revision: marketEvidence.revision, snapshot: market },
  eia: { status: 'stale' as const, revision: eiaEvidence.revision, snapshot: eiaEvidence.snapshot },
};
function frozen(): FrozenFleetSnapshot {
  return structuredClone({ schemaVersion: 1, capturedAt: '2026-10-28T16:27:00.000Z', runInputs: sourceBundle,
    latestContext: { ...sourceBundle, capturedAt: '2026-10-28T16:27:00.000Z', eia: null }, progress }) as FrozenFleetSnapshot;
}
let directory: string;
let servers: Server[];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'sunchaser-fleet-capture-')); servers = []; });
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('sunchaser-fleet-capture-'))
    throw new Error('Refusing to remove an unowned directory');
  await rm(directory, { recursive: true, force: true });
});
const archive = () => createSnapshotArchive<FrozenFleetSnapshot>(directory, 'fleet-captures');
async function application(store: SnapshotStore<FrozenFleetSnapshot> = archive()) {
  const api = createFleetCaptureApi(store);
  const server = createServer((request, response) => api(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/fleet/captures`;
}
const save = (url: string, value: unknown, headers: Record<string, string> = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
});

async function enrichedFrozen(): Promise<FrozenFleetSnapshot> {
  // Retain the provider capture and explicitly declare synthetic extra hours/metrics
  // for this contract example. These additions are not recorded public observations.
  const response = weatherEvidence.response.map(location => {
    const copy = structuredClone(location);
    for (let index = copy.hourly.time.length; index < 168; index++) {
      copy.hourly.time.push(new Date(Date.parse('2026-10-28T00:00:00Z') + index * 3_600_000).toISOString().slice(0,16));
      copy.hourly.shortwave_radiation.push(321);
    }
    return { ...copy, hourly_units:{...copy.hourly_units,shortwave_radiation_instant:'W/m²',temperature_2m:'°C',cloud_cover:'%'},
      hourly:{...copy.hourly,shortwave_radiation_instant:Array(168).fill(250),temperature_2m:Array(168).fill(20),cloud_cover:Array(168).fill(25)} };
  });
  response[0].hourly.temperature_2m[17] = null;
  const expanded = parseSiteWeatherResponse(response, weatherEvidence.retrievedAt, {selection:{
    sites:weather.sites.map(({locationId,latitude,longitude})=>({id:locationId,latitude,longitude})),forecastDays:7,
    variables:['shortwave_radiation','shortwave_radiation_instant','temperature_2m','cloud_cover'],
  }});
  const selected = captureLiveFleet(feed(expanded), feed(market), Date.parse(capturedAt));
  if (!selected.available) throw new Error(selected.reason);
  const {map:_ignored,...expandedProgress} = await createPairedReplaySession(selected.capture.scenario).step();
  const bundle = {...sourceBundle,weather:{status:'ready' as const,revision:snapshotRevision(expanded),snapshot:expanded}};
  return {schemaVersion:1,capturedAt:'2026-10-28T16:27:00.000Z',runInputs:bundle,
    latestContext:{...bundle,capturedAt:'2026-10-28T16:27:00.000Z',eia:null},progress:expandedProgress} as FrozenFleetSnapshot;
}

test('a seven-day multi-metric forecast survives freezing and a new server with its exact provenance and missing readings', async () => {
  const original = await enrichedFrozen();
  const snapshot = original.runInputs.weather!.snapshot;
  expect(snapshot.sites[0].intervals).toHaveLength(168);
  expect(snapshot.sites[0].instantaneous![17].temperatureC).toBeNull();
  expect(snapshot.metadata).toMatchObject({sourceKind:'forecast',issuedAt:null,selection:{forecastDays:7}});
  const saved = await save(await application(),original);
  expect(saved.status).toBe(201);
  const receipt = await saved.json();
  expect(receipt).toEqual({revision:snapshotRevision(original),capture:original});
  const restarted = await application();
  const read = await fetch(restarted+'?revision='+receipt.revision);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(receipt);
});

test('enriched weather rejects unknown fields, forged coverage, changed units and readings at a different hour', async () => {
  const url = await application();
  const original = await enrichedFrozen();
  const changes = [
    (snapshot: Record<string, any>) => { snapshot.metadata.privateLocation = 'unrelated'; },
    (snapshot: Record<string, any>) => { snapshot.metadata.selection.privateLocation = 'unrelated'; },
    (snapshot: Record<string, any>) => { snapshot.metadata.selection.sites[0].privateLocation = 'unrelated'; },
    (snapshot: Record<string, any>) => { snapshot.metadata.variables.temperature_2m.privateLocation = 'unrelated'; },
    (snapshot: Record<string, any>) => { snapshot.metadata.variables.temperature_2m.unit = '°F'; },
    (snapshot: Record<string, any>) => { snapshot.sites[0].coverage[2].availableHours = 168; },
    (snapshot: Record<string, any>) => { snapshot.sites[0].instantaneous[17].at = '2026-10-28T18:00:00.000Z'; },
    (snapshot: Record<string, any>) => { snapshot.sites[0].instantaneous[17].privateLocation = 'unrelated'; },
    (snapshot: Record<string, any>) => { snapshot.sites[0].instantaneous[17].cloudCoverPercent = 101; },
    (snapshot: Record<string, any>) => { snapshot.metadata.apiKey = 'never-store-this'; },
  ];
  for (const change of changes) {
    const invalid = structuredClone(original);
    // Latest context is independent of pinned run inputs. Recompute its checksum so
    // rejection exercises the source-field contract, not an unrelated revision guard.
    invalid.latestContext.weather = structuredClone(original.latestContext.weather);
    change(invalid.latestContext.weather!.snapshot);
    invalid.latestContext.weather!.revision = snapshotRevision(invalid.latestContext.weather!.snapshot);
    expect((await save(url,invalid)).status).toBe(400);
  }
  expect(await archive().latest()).toBeNull();
});

test('a paused capture keeps source evidence and progress exactly across immutable retries and a new archive/server instance', async () => {
  const url = await application();
  const original = frozen();
  const saved = await save(url, original, { Origin: new URL(url).origin });
  expect(saved.status).toBe(201);
  expect(saved.headers.get('cache-control')).toBe('no-store');
  const receipt = await saved.json();
  expect(receipt).toEqual({ revision: snapshotRevision(original), capture: original });
  expect((await archive().read(receipt.revision))?.evidence.format).toBe('frozen-fleet-v1');
  expect(await (await save(url, original)).json()).toEqual(receipt);
  const restarted = await application();
  const read = await fetch(restarted + '?revision=' + receipt.revision);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(receipt);
  // Saving does not advance the real engine or replace the original EIA source timestamp.
  expect(receipt.capture.progress).toMatchObject({ hour: 1, phase: 'settled', done: false });
  expect(receipt.capture.runInputs.eia.snapshot.retrievedAt).toBe(eiaEvidence.snapshot.retrievedAt);
  expect(receipt.capture.latestContext.eia).toBeNull();
});

test('malformed topology, active dispatch, source revision mismatches and credential fields cannot be archived', async () => {
  const url = await application();
  const badRevision = frozen(); badRevision.runInputs.weather!.revision = 'f'.repeat(64);
  const wrongSource = frozen(); wrongSource.runInputs.weather!.snapshot.sites[0].intervals[18].shortwaveRadiationWm2 = 0;
  wrongSource.runInputs.weather!.revision = snapshotRevision(wrongSource.runInputs.weather!.snapshot);
  const routed = frozen(); routed.progress.phase = 'routed';
  const invalidHour = frozen(); invalidHour.progress.hour = 25;
  const secret = { ...frozen(), apiKey: 'never-store-this' };
  const derivedMap = frozen() as FrozenFleetSnapshot & { progress: { map?: unknown } }; derivedMap.progress.map = {};
  for (const invalid of [badRevision, wrongSource, routed, invalidHour, secret, derivedMap, { schemaVersion: 1 }])
    expect((await save(url, invalid)).status).toBe(400);
  expect(await archive().latest()).toBeNull();
});

test('cross-origin and oversized writes fail without publishing; missing or malformed revisions remain distinct', async () => {
  const url = await application();
  expect((await save(url, frozen(), { Origin: 'https://unrelated.example' })).status).toBe(403);
  expect((await save(url, { ...frozen(), padding: 'x'.repeat(5 * 1024 * 1024) })).status).toBe(413);
  expect((await fetch(url + '?revision=' + 'a'.repeat(64))).status).toBe(404);
  expect((await fetch(url + '?revision=invalid')).status).toBe(400);
  expect((await fetch(url + '?revision=' + 'a'.repeat(64) + '&revision=' + 'b'.repeat(64))).status).toBe(400);
  expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  expect(await archive().latest()).toBeNull();
});

test('storage write failures and forged archive responses return no successful capture or private diagnostic', async () => {
  const store = archive();
  const expected = frozen();
  const revision = snapshotRevision(expected);
  const failing = await application({ ...store, async save() { throw new Error('private database location'); } });
  const failure = await save(failing, expected);
  expect(failure.status).toBe(503);
  expect(JSON.stringify(await failure.json())).not.toContain('private database location');
  const forged = await application({ ...store, async read() { return { revision,
    snapshot: { ...expected, capturedAt: '2026-10-28T16:29:00.000Z' }, evidence: { format: 'frozen-fleet-v1', body: {} } }; } });
  expect((await fetch(forged + '?revision=' + revision)).status).toBe(503);
  expect(await store.latest()).toBeNull();
});

test('chunked oversized requests receive a complete error response and cannot publish partial JSON', async () => {
  const url = await application();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: new Blob(['x'.repeat(5 * 1024 * 1024 + 1)]).stream(), duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: 'Fleet capture exceeds the 5 MiB limit.' });
  expect(await archive().latest()).toBeNull();
});
