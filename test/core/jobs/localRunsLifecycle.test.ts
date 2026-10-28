import { expect, test, vi } from 'vitest';
import { createLocalRuns } from '../../../src/server/jobs/localRuns';
import { createRecordedGridFeeds, type GridSnapshotStores } from '../../../src/server/gridFeeds';
import type { JobRunStore, StoredJob } from '../../../src/server/jobs/JobRunStore.type';
import type { LocalRun, LocalRunRequest } from '../../../src/data/LocalRun.type';
import type { runLocalWorkload, WorkerResult } from '../../../src/server/jobs/localWorker';
import type { SnapshotStore, StoredSnapshot } from '../../../src/server/SnapshotStore.type';
import type { EiaApiSnapshot } from '../../../src/core/energy/data/eiaApi';
import type { CaisoSnapshot } from '../../../src/server/caiso';
import manifest from '../../fixtures/public-grid/manifest.json';
import eiaCapture from '../../fixtures/public-grid/eia.json';
import caisoCapture from '../../fixtures/public-grid/caiso.json';

// These substitutes exercise service ownership and storage ordering. Actual child
// execution and SQLite durability are established by their separate integration tests.
function memoryStore<T>(): JobRunStore<T> {
  const records = new Map<string, StoredJob<T>>();
  return {
    async create(id, value) {
      if (records.has(id)) return false;
      records.set(id, { version: 1, value: structuredClone(value) });
      return true;
    },
    async read(id) { return structuredClone(records.get(id) ?? null); },
    async update(id, expectedVersion, value) {
      if (records.get(id)?.version !== expectedVersion) return false;
      records.set(id, { version: expectedVersion + 1, value: structuredClone(value) });
      return true;
    },
  };
}
function capturedStore<T>(record: StoredSnapshot<T>): SnapshotStore<T> {
  return {
    async save() { throw new Error('Captured inputs are read-only'); },
    async latest() { return structuredClone(record); },
    async read(revision) { return revision === record.revision ? structuredClone(record) : null; },
  };
}
const snapshots: GridSnapshotStores = {
  eia: capturedStore(eiaCapture as StoredSnapshot<EiaApiSnapshot>),
  caiso: capturedStore(caisoCapture as StoredSnapshot<CaisoSnapshot>),
};
const at = '2026-10-28T12:00:00.000Z';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
function request(requestId = firstId): LocalRunRequest {
  return {
    requestId, workload: { kind: 'integer-sum', values: [1, 2, 3, 4] },
    inputRevisions: { eia: manifest.feeds.eia.revision, caiso: manifest.feeds.caiso.revision },
    policy: { maximumDemandMW: 6000, maximumWholesaleUsdPerMWh: 75, maximumAgeMinutes: { eia: 180, caiso: 20 } },
    model: { computeKWh: 10, roundTripEfficiency: 0.8 },
  };
}
function failed(): WorkerResult {
  return { pid: 123, startedAt: at, completedAt: at, exitCode: null, signal: 'SIGTERM', outputText: null, error: 'Local workload was cancelled.' };
}
function workerSubstitute() {
  const started = Promise.withResolvers<void>();
  const outcome = Promise.withResolvers<WorkerResult>();
  const worker = vi.fn<typeof runLocalWorkload>(async (_workload, onEvent) => {
    started.resolve();
    await onEvent({ state: 'running', at, pid: 123 });
    return outcome.promise;
  });
  return { worker, started, outcome };
}
function service(store: JobRunStore<LocalRun>, worker: typeof runLocalWorkload) {
  return createLocalRuns({ store, snapshots, feeds: createRecordedGridFeeds(snapshots),
    recordedAsOf: manifest.asOf, now: () => Date.parse(at), worker });
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('a published job remains owned while its create acknowledgement is pending, and starts once afterward', async () => {
  const durable = memoryStore<LocalRun>();
  const published = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const store: JobRunStore<LocalRun> = { ...durable, async create(id, value) {
    const created = await durable.create(id, value);
    published.resolve();
    await acknowledge.promise;
    return created;
  } };
  const controlled = workerSubstitute();
  const jobs = service(store, controlled.worker);
  const submission = jobs.submit(request());
  try {
    await published.promise;
    expect((await jobs.read(firstId))?.status).toBe('queued');
    expect(controlled.worker).not.toHaveBeenCalled();
    acknowledge.resolve();
    expect((await submission).decision.action).toBe('run');
    await controlled.started.promise;
    expect(controlled.worker).toHaveBeenCalledTimes(1);
  } finally {
    acknowledge.resolve();
    await submission.catch(() => {});
    controlled.outcome.resolve(failed());
    await jobs.close();
  }
});

test('shutdown drains an in-flight publication without launching work after close', async () => {
  const durable = memoryStore<LocalRun>();
  const published = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const store: JobRunStore<LocalRun> = { ...durable, async create(id, value) {
    const created = await durable.create(id, value);
    published.resolve();
    await acknowledge.promise;
    return created;
  } };
  const controlled = workerSubstitute();
  const jobs = service(store, controlled.worker);
  const submission = jobs.submit(request()).catch(() => null);
  await published.promise;
  let closed = false;
  const closing = jobs.close().then(() => { closed = true; });
  try {
    await nextTurn();
    expect(closed).toBe(false);
    acknowledge.resolve();
    await submission;
    await closing;
    expect(controlled.worker).not.toHaveBeenCalled();
    expect((await jobs.read(firstId))?.status).toBe('interrupted');
  } finally {
    acknowledge.resolve();
    controlled.outcome.resolve(failed());
    await submission;
    await closing;
    await jobs.close();
  }
});

test('a progress callback released after cancellation cannot revive the persisted failed run', async () => {
  const durable = memoryStore<LocalRun>();
  const readStarted = Promise.withResolvers<void>();
  const releaseRead = Promise.withResolvers<void>();
  const terminalSaved = Promise.withResolvers<void>();
  const cancel = Promise.withResolvers<void>();
  let delayNextRead = false;
  let progress: Promise<void> | undefined;
  const store: JobRunStore<LocalRun> = { ...durable,
    async read(id) {
      if (delayNextRead) { delayNextRead = false; readStarted.resolve(); await releaseRead.promise; }
      return durable.read(id);
    },
    async update(id, version, value) {
      const updated = await durable.update(id, version, value);
      if (updated && value.status === 'failed') terminalSaved.resolve();
      return updated;
    },
  };
  const worker = vi.fn<typeof runLocalWorkload>(async (_workload, onEvent, options) => {
    delayNextRead = true;
    progress = onEvent({ state: 'progress', at, pid: 123, completed: 1, total: 4 });
    void progress.catch(() => {});
    // The real worker can settle after cancellation while a previously started callback is pending.
    options?.signal?.addEventListener('abort', () => cancel.resolve(), { once: true });
    await cancel.promise;
    return failed();
  });
  const jobs = service(store, worker);
  try {
    await jobs.submit(request());
    await readStarted.promise;
    const closing = jobs.close();
    await terminalSaved.promise;
    expect((await durable.read(firstId))?.value.status).toBe('failed');
    releaseRead.resolve();
    await progress?.catch(() => {});
    await closing;
    expect((await durable.read(firstId))?.value.status).toBe('failed');
    expect((await jobs.read(firstId))?.execution.output).toBeNull();
  } finally {
    releaseRead.resolve(); cancel.resolve();
    await progress?.catch(() => {});
    await jobs.close();
  }
});

test('concurrent duplicate requests launch once, changed work is rejected, and a busy second job stays blocked', async () => {
  const durable = memoryStore<LocalRun>();
  const controlled = workerSubstitute();
  const jobs = service(durable, controlled.worker);
  try {
    const duplicate = await Promise.all([jobs.submit(request()), jobs.submit(request())]);
    expect(duplicate.map(run => run.id)).toEqual([firstId, firstId]);
    await controlled.started.promise;
    expect(controlled.worker).toHaveBeenCalledTimes(1);
    await expect(jobs.submit({ ...request(), workload: { kind: 'integer-sum', values: [99] } })).rejects.toThrow(/different work/i);
    const waiting = await jobs.submit(request(secondId));
    expect(waiting).toMatchObject({ status: 'blocked', decision: { action: 'wait' }, execution: { pid: null, output: null } });
    expect(waiting.decision.inputs.every(input => input.accepted)).toBe(true);
    controlled.outcome.resolve({ pid: 123, startedAt: at, completedAt: at, exitCode: 0, signal: null,
      outputText: JSON.stringify({ requestId: firstId, sum: 10 }) });
    await nextTurn();
    expect((await jobs.read(firstId))?.status).toBe('done');
    expect((await jobs.submit(request(secondId))).status).toBe('blocked');
    expect(controlled.worker).toHaveBeenCalledTimes(1);
  } finally {
    controlled.outcome.resolve(failed());
    await jobs.close();
  }
});

test('failed progress and failure persistence expose no result, and restart interrupts the old job without executing it again', async () => {
  const durable = memoryStore<LocalRun>();
  const store: JobRunStore<LocalRun> = { ...durable, async update() { throw new Error('Storage unavailable'); } };
  const worker = vi.fn<typeof runLocalWorkload>(async (_workload, onEvent) => {
    await onEvent({ state: 'running', at, pid: 123 });
    return failed();
  });
  const jobs = service(store, worker);
  await jobs.submit(request());
  await nextTurn();
  await expect(jobs.read(firstId)).rejects.toThrow(/durably saved/i);
  expect((await durable.read(firstId))?.value).toMatchObject({ status: 'queued', execution: { output: null } });
  await jobs.close();
  const restartedWorker = vi.fn<typeof runLocalWorkload>(async () => failed());
  const restarted = service(durable, restartedWorker);
  try {
    expect(await restarted.read(firstId)).toMatchObject({ status: 'interrupted', execution: { output: null } });
    expect((await restarted.submit(request())).status).toBe('interrupted');
    expect(restartedWorker).not.toHaveBeenCalled();
  } finally { await restarted.close(); }
});

test('failure to publish the initial durable record prevents any worker launch', async () => {
  const durable = memoryStore<LocalRun>();
  const store: JobRunStore<LocalRun> = { ...durable, async create() { throw new Error('Storage unavailable'); } };
  const worker = vi.fn<typeof runLocalWorkload>(async () => failed());
  const jobs = service(store, worker);
  try {
    await expect(jobs.submit(request())).rejects.toThrow(/storage unavailable/i);
    expect(await jobs.read(firstId)).toBeNull();
    expect(worker).not.toHaveBeenCalled();
  } finally { await jobs.close(); }
});

test('an earlier running read cannot overwrite a completed result with a restart interruption', async () => {
  const durable = memoryStore<LocalRun>();
  const readCaptured = Promise.withResolvers<void>();
  const returnRead = Promise.withResolvers<void>();
  let delayNextRead = false;
  const store: JobRunStore<LocalRun> = { ...durable, async read(id) {
    const saved = await durable.read(id);
    if (delayNextRead) { delayNextRead = false; readCaptured.resolve(); await returnRead.promise; }
    return saved;
  } };
  const controlled = workerSubstitute();
  const jobs = service(store, controlled.worker);
  let reading: Promise<LocalRun | null> | undefined;
  try {
    await jobs.submit(request());
    await controlled.started.promise;
    await nextTurn();
    expect((await durable.read(firstId))?.value.status).toBe('running');
    delayNextRead = true;
    reading = jobs.read(firstId);
    await readCaptured.promise;
    controlled.outcome.resolve({ pid: 123, startedAt: at, completedAt: at, exitCode: 0, signal: null,
      outputText: JSON.stringify({ requestId: firstId, sum: 10 }) });
    await nextTurn();
    expect((await durable.read(firstId))?.value.status).toBe('done');
    returnRead.resolve();
    expect((await reading)?.status).toBe('done');
    const saved = await durable.read(firstId);
    expect(saved?.value.execution.events.map(event => event.state)).not.toContain('interrupted');
    expect(saved?.value.execution.output?.text).toBe(JSON.stringify({ requestId: firstId, sum: 10 }));
  } finally {
    returnRead.resolve();
    await reading?.catch(() => {});
    controlled.outcome.resolve(failed());
    await jobs.close();
  }
});
