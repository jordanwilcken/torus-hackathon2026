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
