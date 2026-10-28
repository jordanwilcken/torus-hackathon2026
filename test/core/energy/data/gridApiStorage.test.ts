import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { strToU8, zipSync } from 'fflate';
import { createGridApi } from '../../../../src/server/gridApi';
import type { SnapshotStore, StoredSnapshot } from '../../../../src/server/SnapshotStore.type';
import type { EiaApiSnapshot } from '../../../../src/core/energy/data/eiaApi';
import type { CaisoSnapshot } from '../../../../src/server/caiso';

// A test substitute proves dependency routing, not database durability. The real
// filesystem implementation has separate archive and HTTP integration coverage.
function suppliedStore<T>() {
  const records = new Map<string, StoredSnapshot<T>>();
  let current: string | undefined;
  const store: SnapshotStore<T> = {
    save: vi.fn(async (snapshot, evidence) => {
      const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      records.set(revision, structuredClone({ revision, snapshot, evidence }));
      current = revision;
      return revision;
    }),
    latest: vi.fn(async () => current ? structuredClone(records.get(current)!) : null),
    read: vi.fn(async revision => structuredClone(records.get(revision) ?? null)),
  };
  return store;
}
const stores = () => ({ eia: suppliedStore<EiaApiSnapshot>(), caiso: suppliedStore<CaisoSnapshot>() });
let servers: Server[];
let at: number;
let demand: string;
let unavailable: boolean;
let sourceRequests: number;
const csv = 'INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,NODE_ID,MARKET_RUN_ID,LMP_TYPE,VALUE\r\n2026-10-28T08:00:00Z,2026-10-28T08:05:00Z,ELAP_PACE-APND,RTM,LMP,-7.125\r\n';
const fetcher: typeof fetch = async input => {
  sourceRequests++;
  if (unavailable) throw new Error('Private source details');
  if (String(input).includes('api.eia.gov')) return Response.json({ response: {
    frequency: 'hourly', dateFormat: 'YYYY-MM-DD"T"HH24', total: '1', data: [
      { period: '2026-10-28T07', respondent: 'PACE', type: 'D', value: demand, 'value-units': 'megawatthours' },
    ],
  } });
  return new Response(Buffer.from(zipSync({ 'prices.csv': strToU8(csv) })));
};
beforeEach(() => { servers = []; at = Date.parse('2026-10-28T08:00:00Z'); demand = '5429'; unavailable = false; sourceRequests = 0; });
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
async function application(storage: ReturnType<typeof stores>, offline = false) {
  const api = createGridApi('fixture-key', storage, { offline, fetcher, now: () => at });
  const server = createServer((request, response) => api(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/grid`;
}
async function read(base: string, path = '/eia') {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.json() };
}

test('both feeds publish and replay through supplied stores without a filesystem location', async () => {
  const storage = stores();
  const base = await application(storage);
  for (const feed of ['eia', 'caiso'] as const) {
    const live = (await read(base, '/' + feed)).body;
    expect(live.status).toBe('ready');
    const record = await storage[feed].read(live.revision);
    expect(record).toMatchObject({ revision: live.revision, snapshot: live.snapshot });
    expect(record?.evidence.format).toBe(feed === 'eia' ? 'eia-response-v1' : 'caiso-csv-v1');
    const before = sourceRequests;
    expect((await read(base, `/${feed}?revision=${live.revision}`)).body)
      .toEqual({ archived: true, revision: live.revision, snapshot: live.snapshot });
    expect(sourceRequests).toBe(before);
  }
});

test('a fresh API restores the supplied store and preserves its revision when the source fails', async () => {
  const storage = stores();
  const original = (await read(await application(storage))).body;
  unavailable = true; at += 3_600_000;
  const recovered = (await read(await application(storage))).body;
  expect(recovered).toMatchObject({ status: 'stale', revision: original.revision, snapshot: original.snapshot });
  expect(recovered.lastAttemptAt).toBe('2026-10-28T09:00:00.000Z');
});

test('changing storage bindings isolates locations and exact replay never searches another store', async () => {
  const locationA = stores();
  const first = (await read(await application(locationA))).body;
  demand = '5500'; at += 900_000;
  const locationB = stores();
  const secondBase = await application(locationB);
  const second = (await read(secondBase)).body;
  expect(second.revision).not.toBe(first.revision);
  expect(await locationA.eia.latest()).toMatchObject({ snapshot: first.snapshot });
  expect(await locationB.eia.latest()).toMatchObject({ snapshot: second.snapshot });
  const before = sourceRequests;
  expect((await read(secondBase, '/eia?revision=' + first.revision)).status).toBe(404);
  expect(sourceRequests).toBe(before);
});

test('a substituted backend write failure retains the last published input and hides private errors', async () => {
  const storage = stores();
  const base = await application(storage);
  const first = (await read(base)).body;
  vi.mocked(storage.eia.save).mockRejectedValue(new Error('Private database URL'));
  demand = '5500'; at += 900_000;
  const after = (await read(base)).body;
  expect(after).toMatchObject({ status: 'stale', revision: first.revision, snapshot: first.snapshot });
  expect(after.error).toContain('could not be saved');
  expect(JSON.stringify(after)).not.toContain('Private database URL');
  vi.mocked(storage.eia.read).mockRejectedValue(new Error('Private database URL'));
  const before = sourceRequests;
  const replay = await read(base, '/eia?revision=' + first.revision);
  expect(replay.status).toBe(503);
  expect(sourceRequests).toBe(before);
  expect(JSON.stringify(replay)).not.toContain('Private database URL');
});

test('offline mode does not call any operation on a supplied store', async () => {
  const storage = stores();
  const base = await application(storage, true);
  expect((await read(base)).body.status).toBe('unavailable');
  expect((await read(base, '/eia?revision=' + 'a'.repeat(64))).status).toBe(503);
  expect((await read(base, '/caiso')).body.status).toBe('unavailable');
  for (const store of Object.values(storage)) for (const operation of Object.values(store)) expect(operation).not.toHaveBeenCalled();
  expect(sourceRequests).toBe(0);
});

test('a backend cannot silently change the shared revision rule when saving a publication', async () => {
  const storage = stores();
  vi.mocked(storage.eia.save).mockResolvedValue('0'.repeat(64));
  const result = (await read(await application(storage))).body;
  expect(result).toMatchObject({ status: 'unavailable', snapshot: null, revision: null });
  expect(result.error).toContain('could not be saved');
});
