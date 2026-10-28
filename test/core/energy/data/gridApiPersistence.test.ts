import { afterEach, beforeEach, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createGridApi } from '../../../../src/server/gridApi';

let directory: string;
let servers: Server[];
let at: number;
let demand: string;
let failed: boolean;
let requests: number;
const csv = 'INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,NODE_ID,MARKET_RUN_ID,LMP_TYPE,VALUE\r\n2026-10-28T08:00:00Z,2026-10-28T08:05:00Z,ELAP_PACE-APND,RTM,LMP,-7.125\r\n';
const fetcher: typeof fetch = async input => {
  requests++;
  if (failed) throw new Error('Upstream failed with secret-fixture');
  if (String(input).includes('api.eia.gov')) return Response.json({
    request: { api_key: 'secret-fixture' }, response: { frequency: 'hourly', dateFormat: 'YYYY-MM-DD"T"HH24', total: '1', data: [
      { period: '2026-10-28T07', respondent: 'PACE', type: 'D', value: demand, 'value-units': 'megawatthours', ignored: 'secret-fixture' },
    ] },
  });
  return new Response(Buffer.from(zipSync({ 'prices.csv': strToU8(csv) })));
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sunchaser-grid-archive-'));
  servers = []; at = Date.parse('2026-10-28T08:00:00Z'); demand = '5429'; failed = false; requests = 0;
});
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('sunchaser-grid-archive-')) throw new Error('Unsafe temporary path');
  await rm(directory, { recursive: true, force: true });
});
async function application(offline = false) {
  const api = createGridApi('secret-fixture', offline, { archiveDirectory: directory, fetcher, now: () => at });
  const server = createServer((request, response) => api(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/grid`;
}
async function read(base: string, path = '/eia') {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.json() };
}

test('saves both normalized feeds and sanitized reproducible source evidence before publishing', async () => {
  const base = await application();
  const eia = (await read(base)).body;
  const caiso = (await read(base, '/caiso')).body;
  expect(eia.status).toBe('ready');
  expect(caiso.snapshot.prices[0].usdPerMWh).toBe(-7.125);
  const eiaBytes = await readFile(join(directory, 'eia', eia.revision + '.json'), 'utf8');
  const record = JSON.parse(eiaBytes);
  expect(record.snapshot).toEqual(eia.snapshot);
  expect(record.evidence.body.response.data[0].value).toBe('5429');
  expect(record.evidence.body.retrievedAt).toBe(eia.snapshot.retrievedAt);
  expect(eiaBytes).not.toContain('secret-fixture');
  const market = JSON.parse(await readFile(join(directory, 'caiso', caiso.revision + '.json'), 'utf8'));
  expect(market.evidence.body.csv).toBe(csv);
});

test('a restarted application retains the saved revision and original timestamps when both sources fail', async () => {
  const original = await application();
  const eia = (await read(original)).body;
  const caiso = (await read(original, '/caiso')).body;
  failed = true; at += 3_600_000;
  const restarted = await application();
  for (const [path, before] of [['/eia', eia], ['/caiso', caiso]] as const) {
    const after = (await read(restarted, path)).body;
    expect(after.status).toBe('stale');
    expect(after.revision).toBe(before.revision);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.lastAttemptAt).toBe('2026-10-28T09:00:00.000Z');
    expect(JSON.stringify(after)).not.toContain('secret-fixture');
  }
});

test('an exact revision replays old evidence without fetching or substituting the newer publication', async () => {
  const base = await application();
  const first = (await read(base)).body;
  at += 900_000; demand = '5500';
  const second = (await read(base)).body;
  expect(second.revision).not.toBe(first.revision);
  const beforeRequests = requests;
  const replay = await read(base, '/eia?revision=' + first.revision);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual({ archived: true, revision: first.revision, snapshot: first.snapshot });
  expect(requests).toBe(beforeRequests);
  expect((await read(base, '/eia?revision=' + 'f'.repeat(64))).status).toBe(404);
  expect((await read(base, '/caiso?revision=' + first.revision)).status).toBe(404);
  expect((await read(base, '/eia?revision=..%2Flatest')).status).toBe(400);
  expect(requests).toBe(beforeRequests);
});

test('a persistence failure retains the prior publication rather than claiming new durable data', async () => {
  const base = await application();
  const before = (await read(base)).body;
  const pointer = join(directory, 'eia', 'latest.json');
  await rm(pointer);
  await mkdir(pointer);
  at += 900_000; demand = '5500';
  const after = (await read(base)).body;
  expect(after.status).toBe('stale');
  expect(after.revision).toBe(before.revision);
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.error).toContain('could not be saved');
});

test('corrupt saved data stays unavailable on restart and exact replay fails without live fallback', async () => {
  const base = await application();
  const before = (await read(base)).body;
  await writeFile(join(directory, 'eia', before.revision + '.json'), '{corrupt secret-fixture');
  failed = true;
  const restarted = await application();
  const latest = (await read(restarted)).body;
  expect(latest).toMatchObject({ status: 'unavailable', snapshot: null, revision: null });
  expect(latest.error).toContain('Saved snapshot could not be loaded.');
  const beforeRequests = requests;
  const replay = await read(restarted, '/eia?revision=' + before.revision);
  expect(replay.status).toBe(503);
  expect(JSON.stringify(replay.body)).not.toContain('secret-fixture');
  expect(requests).toBe(beforeRequests);
});

test('the offline test server never loads local archives or calls upstream services', async () => {
  const live = await application();
  const saved = (await read(live)).body;
  const beforeRequests = requests;
  const offline = await application(true);
  expect((await read(offline)).body).toMatchObject({ status: 'unavailable', snapshot: null, revision: null });
  expect((await read(offline, '/eia?revision=' + saved.revision)).status).toBe(503);
  expect(requests).toBe(beforeRequests);
});
