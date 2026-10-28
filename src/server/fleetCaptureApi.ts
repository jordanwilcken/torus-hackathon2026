import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SnapshotStore } from './SnapshotStore.type.ts';
import type { FrozenFleetSnapshot } from '../data/FrozenFleet.type.ts';
import type { ReplayScenario } from '../core/execution/replay/Replay.types.ts';
import { prepareScenario } from '../core/execution/replay/prepareScenario.ts';
import { snapshotRevision } from './snapshotRevision.ts';

const maximumBytes = 5 * 1024 * 1024;
const revisionPattern = /^[a-f0-9]{64}$/;
const credentialKey = /^(?:api[_-]?key|password|authorization|cookie|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|token|credentials)$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).some(key => !names.includes(key)) || names.some(key => !Object.hasOwn(result, key)))
    throw new Error('Unexpected capture fields');
  return result;
}
function time(value: unknown): number {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !value.endsWith('Z')) throw new Error('Invalid UTC timestamp');
  return Date.parse(value);
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Capture exceeds topology limits');
  return value;
}
function integer(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new Error('Invalid progress');
  return value as number;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function period(value: unknown): void {
  const window = fields(value, ['startAt', 'endAt']);
  if (time(window.endAt) <= time(window.startAt)) throw new Error('Invalid source interval');
}

/** Only JSON evidence enters the archive; credential-bearing fields/URLs and derived Maps are not capture inputs. */
function safeJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (depth > 64 || ++budget.nodes > 200_000) throw new Error('Capture is too deeply nested');
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password || [...url.searchParams.keys()].some(key => credentialKey.test(key)))
      throw new Error('Credential-bearing source URL');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite capture value');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (credentialKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe capture field');
    safeJson(child, depth + 1, budget);
  }
}

function source(value: unknown, kind: 'weather' | 'caiso' | 'eia'): void {
  if (value === null) return;
  const supplied = fields(value, ['revision', 'snapshot', 'status']);
  if (!['ready', 'stale'].includes(String(supplied.status)) || typeof supplied.revision !== 'string' ||
      !revisionPattern.test(supplied.revision) || snapshotRevision(supplied.snapshot) !== supplied.revision)
    throw new Error('Source publication revision mismatch');
  const snapshot = object(supplied.snapshot);
  time(snapshot.retrievedAt);
  if (kind === 'weather') {
    fields(snapshot, ['source', 'retrievedAt', 'sites']);
    if (snapshot.source !== 'Open-Meteo') throw new Error('Unsupported weather source');
    const sites = list(snapshot.sites, 64);
    const ids = new Set<string>();
    if (!sites.length) throw new Error('Weather sites are missing');
    for (const value of sites) {
      const site = fields(value, ['locationId', 'latitude', 'longitude', 'intervals']);
      if (typeof site.locationId !== 'string' || !site.locationId || ids.has(site.locationId) ||
          !finite(site.latitude) || Math.abs(site.latitude) > 90 || !finite(site.longitude) || Math.abs(site.longitude) > 180)
        throw new Error('Invalid weather site');
      ids.add(site.locationId);
      for (const value of list(site.intervals, 384)) {
        const interval = fields(value, ['window', 'shortwaveRadiationWm2']);
        period(interval.window);
        if (interval.shortwaveRadiationWm2 !== null && (!finite(interval.shortwaveRadiationWm2) || interval.shortwaveRadiationWm2 < 0))
          throw new Error('Invalid weather reading');
      }
    }
  } else if (kind === 'caiso') {
    fields(snapshot, ['source', 'sourceUrl', 'retrievedAt', 'node', 'prices']);
    if (snapshot.node !== 'ELAP_PACE-APND' || typeof snapshot.source !== 'string' || typeof snapshot.sourceUrl !== 'string')
      throw new Error('Unsupported market source');
    for (const value of list(snapshot.prices, 5000)) {
      const price = fields(value, ['window', 'usdPerMWh']);
      period(price.window);
      if (!finite(price.usdPerMWh)) throw new Error('Invalid market price');
    }
  } else {
    fields(snapshot, ['source', 'sourceUrl', 'retrievedAt', 'regionId', 'observations', 'forecast']);
    if (snapshot.regionId !== 'PACE' || typeof snapshot.source !== 'string' || typeof snapshot.sourceUrl !== 'string')
      throw new Error('Unsupported regional source');
    list(snapshot.observations, 5000);
    object(snapshot.forecast);
  }
}
function bundle(value: unknown): Record<string, unknown> {
  const result = fields(value, ['capturedAt', 'weather', 'caiso', 'eia']);
  time(result.capturedAt);
  for (const kind of ['weather', 'caiso', 'eia'] as const) source(result[kind], kind);
  return result;
}

/** Validate a bounded evidence envelope and scenario structure. This never constructs or advances an executor. */
function captureValue(value: unknown): FrozenFleetSnapshot {
  safeJson(value);
  const capture = fields(value, ['schemaVersion', 'capturedAt', 'runInputs', 'latestContext', 'progress']);
  if (capture.schemaVersion !== 1) throw new Error('Unsupported capture version');
  time(capture.capturedAt);
  const runInputs = bundle(capture.runInputs);
  bundle(capture.latestContext);
  if (!runInputs.weather || !runInputs.caiso) throw new Error('Run inputs require weather and market evidence');
  const progress = fields(capture.progress, ['hour', 'totalHours', 'phase', 'done', 'armHours', 'armDone', 'scenario', 'baseline', 'selected']);
  if (!['ready', 'settled', 'complete'].includes(String(progress.phase))) throw new Error('Dispatch must settle before capture');
  const scenario = object(progress.scenario);
  if (scenario.inputRevision !== `${object(runInputs.weather).revision}:${object(runInputs.caiso).revision}`)
    throw new Error('Run scenario does not match its captured source revisions');
  const hours = integer(scenario.hours, 72);
  if (hours < 1 || progress.totalHours !== hours) throw new Error('Invalid capture horizon');
  const hour = integer(progress.hour, hours);
  const sites = list(scenario.sites, 64), jobs = list(scenario.jobs, 2000);
  if (!sites.length || !jobs.length) throw new Error('Empty capture topology');
  for (const value of sites) {
    const site = object(value);
    list(site.forecast, hours); list(site.observations, hours);
  }
  list(scenario.events ?? [], 2000);
  prepareScenario(scenario as ReplayScenario);
  const armHours = fields(progress.armHours, ['baseline', 'selected']);
  const armDone = fields(progress.armDone, ['baseline', 'selected']);
  if (typeof progress.done !== 'boolean' || typeof armDone.baseline !== 'boolean' || typeof armDone.selected !== 'boolean' ||
      progress.done !== (armDone.baseline && armDone.selected) ||
      (progress.phase === 'complete') !== progress.done || (progress.phase === 'ready' && hour !== 0)) throw new Error('Inconsistent capture phase');
  for (const label of ['baseline', 'selected'] as const) {
    const elapsed = integer(armHours[label], hour);
    const arm = fields(progress[label], ['policy', 'run', 'impact', 'decisions', 'log', 'finalJobs']);
    const run = object(arm.run);
    if (run.simulated !== true || run.arm !== label || run.inputRevision !== scenario.inputRevision)
      throw new Error('Capture must identify modeled execution and its source revision');
    if (list(run.ticks, hours).length !== elapsed || list(run.sites, sites.length).length !== sites.length ||
        list(run.jobs, jobs.length).length !== jobs.length || list(arm.finalJobs, jobs.length).length !== jobs.length)
      throw new Error('Capture progress topology mismatch');
    list(run.transfers, 10_000); list(arm.decisions, hours); list(arm.log, 20_000); object(arm.impact);
  }
  if (hour !== Math.max(armHours.baseline as number, armHours.selected as number)) throw new Error('Inconsistent capture hour');
  return value as FrozenFleetSnapshot;
}

function sameOrigin(request: IncomingMessage): boolean {
  if (!request.headers.origin) return true;
  const scheme = 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http';
  try {
    const origin = new URL(request.headers.origin);
    return origin.origin === request.headers.origin && origin.origin === new URL(`${scheme}://${request.headers.host}`).origin;
  } catch { return false; }
}

export function createFleetCaptureApi(store: SnapshotStore<FrozenFleetSnapshot>) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { response.writeHead(400); response.end(); return; }
    if (url.pathname !== '/api/fleet/captures') { next(); return; }
    const send = (status: number, value: unknown) => {
      if (response.writableEnded) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    void (async () => {
      if (request.method === 'GET') {
        const revisions = url.searchParams.getAll('revision');
        if (revisions.length !== 1 || !revisionPattern.test(revisions[0]) || [...url.searchParams.keys()].some(key => key !== 'revision')) {
          send(400, { error: 'One lowercase SHA-256 capture revision is required.' }); return;
        }
        const record = await store.read(revisions[0]);
        if (!record) { send(404, { error: 'Frozen fleet capture not found.' }); return; }
        if (record.revision !== revisions[0] || snapshotRevision(record.snapshot) !== record.revision || record.evidence.format !== 'frozen-fleet-v1')
          throw new Error('Stored capture revision mismatch');
        send(200, { revision: record.revision, capture: captureValue(record.snapshot) }); return;
      }
      if (request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); send(405, { error: 'Use GET or POST.' }); return; }
      if (!sameOrigin(request)) { request.resume(); send(403, { error: 'Cross-origin capture writes are not allowed.' }); return; }
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        request.resume(); send(415, { error: 'Use application/json.' }); return;
      }
      if (url.search) { request.resume(); send(400, { error: 'Capture writes do not accept query parameters.' }); return; }
      if (Number(request.headers['content-length']) > maximumBytes) {
        request.resume(); send(413, { error: 'Fleet capture exceeds the 5 MiB limit.' }); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of request.iterator({ destroyOnReturn: false })) {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        size += chunk.length;
        if (size > maximumBytes) { request.resume(); send(413, { error: 'Fleet capture exceeds the 5 MiB limit.' }); return; }
        chunks.push(chunk);
      }
      let capture: FrozenFleetSnapshot;
      try { capture = captureValue(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { send(400, { error: 'Invalid frozen fleet evidence, progress, source revision, or fields.' }); return; }
      const expected = snapshotRevision(capture);
      const revision = await store.save(capture, { format: 'frozen-fleet-v1', body: { schemaVersion: 1, capturedAt: capture.capturedAt } });
      if (revision !== expected) throw new Error('Store returned a different capture revision');
      send(201, { revision, capture });
    })().catch(() => send(503, { error: 'Frozen fleet evidence could not be stored or verified. No successful capture is claimed.' }));
  };
}
