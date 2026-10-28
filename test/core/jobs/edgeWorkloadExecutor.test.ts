import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createLocalRuns } from '../../../src/server/jobs/localRuns.ts';
import { edgeWorkloadExecutor, runEdgeWorkload } from '../../../src/server/jobs/edgeWorkloadExecutor.ts';
import { createRecordedGridFeeds } from '../../../src/server/gridFeeds.ts';
import type { JobRunStore, StoredJob } from '../../../src/server/jobs/JobRunStore.type.ts';
import type { LocalRun, LocalRunRequest } from '../../../src/data/LocalRun.type.ts';
import type { StoredSnapshot, SnapshotStore } from '../../../src/server/SnapshotStore.type.ts';
import type { EiaApiSnapshot } from '../../../src/core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from '../../../src/server/caiso.ts';
import type { WorkerEvent } from '../../../src/server/jobs/WorkloadExecutor.type.ts';
import eia from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import caiso from '../../fixtures/public-grid/caiso.json' with { type: 'json' };
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };

function recorded<T>(capture: StoredSnapshot<T>): SnapshotStore<T> {
  return {
    async save() { throw new Error('Captured inputs are read-only'); },
    async latest() { return structuredClone(capture); },
    async read(revision) { return revision === capture.revision ? structuredClone(capture) : null; },
  };
}
const snapshots = { eia: recorded(eia as StoredSnapshot<EiaApiSnapshot>), caiso: recorded(caiso as StoredSnapshot<CaisoSnapshot>) };
function memoryStore<T>(): JobRunStore<T> {
  const values = new Map<string, StoredJob<T>>();
  return {
    async create(id, value) {
      if (values.has(id)) return false;
      values.set(id, { version: 1, value: structuredClone(value) }); return true;
    },
    async read(id) { return structuredClone(values.get(id) ?? null); },
    async update(id, version, value) {
      if (values.get(id)?.version !== version) return false;
      values.set(id, { version: version + 1, value: structuredClone(value) }); return true;
    },
  };
}
const request = (): LocalRunRequest => ({
  requestId: '00000000-0000-4000-8000-000000000001', workload: { kind: 'integer-sum', values: [1, 2, 3, 4] },
  inputRevisions: { eia: eia.revision, caiso: caiso.revision },
  policy: { maximumDemandMW: 6000, maximumWholesaleUsdPerMWh: 75, maximumAgeMinutes: { eia: 180, caiso: 20 } },
  model: { computeKWh: 1, roundTripEfficiency: .9 },
});
const services: Array<ReturnType<typeof createLocalRuns>> = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); });
function service(store: JobRunStore<LocalRun>, executor = edgeWorkloadExecutor) {
  const jobs = createLocalRuns({ store, executor, snapshots, feeds: createRecordedGridFeeds(snapshots), recordedAsOf: manifest.asOf });
  services.push(jobs); return jobs;
}

test('a real isolate calculation completes without inventing a PID or process exit code', async () => {
  const jobs = service(memoryStore());
  const input = request();
  await jobs.submit(input);
  await jobs.waitForIdle();
  const run = (await jobs.read(input.requestId))!;
  expect(run.status).toBe('done');
  expect(run.decision.executionLocation).toBe('Cloudflare');
  expect(run.execution).toMatchObject({ backend: 'cloudflare-durable-object', location: 'Cloudflare', simulated: false, pid: null, exitCode: null, signal: null });
  expect(run.execution.events.map(event => event.state)).toEqual(['queued', 'running', 'progress', 'progress', 'done']);
  expect(run.execution.output?.text).toBe('{"requestId":"00000000-0000-4000-8000-000000000001","sum":10}');
  expect(run.execution.output?.id).toBe(createHash('sha256').update(run.execution.output!.text).digest('hex'));
  expect(run.measuredEnergyKWh).toBeNull();
  expect(run.measuredCarbonKg).toBeNull();
});

test('a recreated owner returns the exact original edge receipt and does not compute it again', async () => {
  const store = memoryStore<LocalRun>();
  const jobs = service(store);
  const input = request();
  await jobs.submit(input); await jobs.waitForIdle();
  const original = await jobs.read(input.requestId);
  await jobs.close();
  const executeAgain = vi.fn(runEdgeWorkload);
  const recreated = service(store, { ...edgeWorkloadExecutor, run: executeAgain });
  expect(await recreated.submit(input)).toEqual(original);
  await recreated.waitForIdle();
  expect(executeAgain).not.toHaveBeenCalled();
});

test('edge computation analyzes the actual captured demand values and reports no process metadata', async () => {
  const jobs = service(memoryStore());
  const input = request(); input.workload = { kind: 'grid-summary' };
  await jobs.submit(input); await jobs.waitForIdle();
  const run = (await jobs.read(input.requestId))!;
  expect(run.status).toBe('done');
  expect(JSON.parse(run.execution.output!.text)).toEqual({ requestId: input.requestId, count: 72, sum: 398799, mean: 5538.875, min: 4569, max: 6702 });
  expect(run.execution.pid).toBeNull();
  expect(run.execution.exitCode).toBeNull();
});

test('actual arithmetic overflow remains a failed run with no successful output', async () => {
  const jobs = service(memoryStore());
  const input = request(); input.workload = { kind: 'integer-sum', values: [Number.MAX_SAFE_INTEGER, 1] };
  await jobs.submit(input); await jobs.waitForIdle();
  const run = (await jobs.read(input.requestId))!;
  expect(run.status).toBe('failed');
  expect(run.execution.error).toBe('Integer sum exceeds the safe integer range.');
  expect(run.execution.output).toBeNull();
  expect(run.execution.exitCode).toBeNull();
});

test('an already cancelled isolate workload never reports progress or produces output', async () => {
  const controller = new AbortController(); controller.abort();
  const events: WorkerEvent[] = [];
  const result = await runEdgeWorkload({ kind: 'integer-sum', requestId: 'cancelled', values: [1] }, async event => { events.push(event); }, { signal: controller.signal });
  expect(result).toMatchObject({ status: 'failed', pid: null, exitCode: null, outputText: null, error: 'Workload was cancelled.' });
  expect(events).toEqual([]);
});

test('failure to persist real progress prevents an isolate success claim', async () => {
  const result = await runEdgeWorkload({ kind: 'integer-sum', requestId: 'progress-failed', values: [1] }, async () => { throw new Error('storage write failed'); });
  expect(result.status).toBe('failed');
  expect(result.outputText).toBeNull();
  expect(result.pid).toBeNull();
});

test('an isolate timeout settles even when a progress acknowledgement stalls', async () => {
  const pending = Promise.withResolvers<void>();
  const events: WorkerEvent[] = [];
  const result = await runEdgeWorkload({ kind: 'integer-sum', requestId: 'stalled', values: [1] }, async event => {
    events.push(event); await pending.promise;
  }, { timeoutMs: 20 });
  expect(result).toMatchObject({ status: 'failed', outputText: null, error: 'Workload timed out.', pid: null, exitCode: null });
  pending.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(events.map(event => event.state)).toEqual(['running']);
});

test('canceling an active isolate workload stops computation after the current acknowledgement', async () => {
  const controller = new AbortController();
  const events: WorkerEvent[] = [];
  const result = await runEdgeWorkload({ kind: 'integer-sum', requestId: 'cancel-active', values: [1, 2] }, async event => {
    events.push(event);
    if (event.state === 'progress') controller.abort();
  }, { signal: controller.signal });
  expect(result.status).toBe('failed');
  expect(result.outputText).toBeNull();
  expect(result.error).toBe('Workload was cancelled.');
  expect(events.map(event => event.state)).toEqual(['running', 'progress']);
});
