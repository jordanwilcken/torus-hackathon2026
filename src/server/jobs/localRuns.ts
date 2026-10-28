import { createHash } from 'node:crypto';
import type { LocalRun, LocalRunRequest } from '../../data/LocalRun.type.ts';
import type { GridFeeds, GridSnapshotStores } from '../gridFeeds.ts';
import type { JobRunStore } from './JobRunStore.type.ts';
import { admitLocalRun } from './admitLocalRun.ts';
import { modelStorageComparison } from './modelStorageComparison.ts';
import type { WorkloadExecutor } from './WorkloadExecutor.type.ts';

export function createLocalRuns(options: {
  store: JobRunStore<LocalRun>; snapshots: GridSnapshotStores; feeds: GridFeeds;
  recordedAsOf?: string; now?: () => number;
  executor: WorkloadExecutor;
}) {
  const { store, snapshots, feeds } = options;
  const now = options.now ?? Date.now;
  const stamp = () => new Date(now()).toISOString();
  const mode = options.recordedAsOf ? 'recorded' : 'live';
  const active = new Map<string, { stop: AbortController; completion: Promise<void> }>();
  const unsaved = new Set<string>();
  const publishing = new Set<string>();
  let admission = Promise.resolve();
  let closed = false;
  async function change(id: string, edit: (run: LocalRun) => void | false) {
    const saved = await store.read(id);
    if (!saved) throw new Error('Run is missing');
    if (edit(saved.value) === false) return saved.value;
    saved.value.updatedAt = stamp();
    if (!await store.update(id, saved.version, saved.value)) throw new Error('Run changed concurrently');
    return saved.value;
  }
  async function read(id: string): Promise<LocalRun | null> {
    if (unsaved.has(id)) throw new Error('Run progress could not be durably saved.');
    const saved = await store.read(id);
    if (!saved) return null;
    if ((saved.value.status === 'queued' || saved.value.status === 'running') && !active.has(id) && !publishing.has(id)) {
      return change(id, run => {
        if (!['queued', 'running'].includes(run.status) || active.has(id) || publishing.has(id)) return false;
        run.status = 'interrupted'; run.execution.completedAt = stamp();
        run.execution.error = 'The server restarted before completion could be confirmed. This run was not executed again.';
        run.execution.events.push({ state: 'interrupted', at: stamp() });
      });
    }
    return saved.value;
  }
  async function execute(run: LocalRun, demandValues: number[], signal: AbortSignal) {
    try {
      const workload = run.request.workload.kind === 'integer-sum'
        ? { kind: 'integer-sum' as const, requestId: run.id, values: run.request.workload.values }
        : { kind: 'grid-summary' as const, requestId: run.id, values: demandValues };
      const outcome = await options.executor.run(workload, async event => {
        if (signal.aborted) return;
        await change(run.id, current => {
          if (signal.aborted || !['queued', 'running'].includes(current.status)) return false;
          current.status = 'running'; current.execution.pid = event.pid;
          current.execution.startedAt ??= event.at;
          current.execution.events.push({ state: event.state, at: event.at, completed: event.completed, total: event.total });
        });
      }, { signal });
      await change(run.id, current => {
        current.execution.pid = outcome.pid; current.execution.startedAt = outcome.startedAt;
        current.execution.completedAt = outcome.completedAt; current.execution.exitCode = outcome.exitCode;
        current.execution.signal = outcome.signal;
        if (outcome.status === 'done' && outcome.outputText !== null && !outcome.error) {
          const output = JSON.parse(outcome.outputText);
          if (output.requestId !== run.id) throw new Error('Worker receipt mismatch');
          current.status = 'done';
          current.execution.output = { id: createHash('sha256').update(outcome.outputText).digest('hex'),
            text: outcome.outputText, contentType: 'application/json' };
        } else {
          current.status = 'failed'; current.execution.error = outcome.error ?? 'Workload execution failed.';
        }
        current.execution.events.push({ state: current.status, at: outcome.completedAt });
      });
    } catch {
      try {
        await change(run.id, current => {
          current.status = 'failed'; current.execution.completedAt = stamp(); current.execution.output = null;
          current.execution.error = 'Execution or durable progress recording failed; no successful result is claimed.';
          current.execution.events.push({ state: 'failed', at: stamp() });
        });
      } catch { unsaved.add(run.id); }
    } finally { active.delete(run.id); }
  }
  async function submit(request: LocalRunRequest): Promise<LocalRun> {
    let release!: () => void;
    const previous = admission;
    admission = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (closed) throw new Error('Local execution is stopping.');
      const existing = await read(request.requestId);
      if (existing) {
        if (JSON.stringify(existing.request) !== JSON.stringify(request)) throw new Error('Request ID already belongs to different work.');
        return existing;
      }
      const [eia, caiso] = await Promise.all([
        snapshots.eia.read(request.inputRevisions.eia), snapshots.caiso.read(request.inputRevisions.caiso),
      ]);
      if (eia && eia.revision !== request.inputRevisions.eia || caiso && caiso.revision !== request.inputRevisions.caiso) throw new Error('Input revision mismatch');
      const at = stamp();
      const decision = { ...admitLocalRun({ eia, caiso }, request.policy, {
        evaluatedAt: at, asOf: options.recordedAsOf ?? at, workerAvailable: active.size === 0,
      }), executionLocation: options.executor.location };
      const price = decision.inputs.find(input => input.feed === 'caiso')?.value ?? null;
      const run: LocalRun = {
        id: request.requestId, request: structuredClone(request), createdAt: at, updatedAt: at, mode,
        status: decision.action === 'run' ? 'queued' : 'blocked', decision,
        comparison: modelStorageComparison({ ...request.model, wholesaleUsdPerMWh: price }),
        execution: { backend: options.executor.backend, location: options.executor.location, simulated: false,
          pid: null, startedAt: null, completedAt: null, exitCode: null, signal: null, output: null, error: null,
          events: [{ state: decision.action === 'run' ? 'queued' : 'blocked', at }] },
        measuredEnergyKWh: null, measuredCarbonKg: null, actualElectricityCostUsd: null,
      };
      publishing.add(run.id);
      if (!await store.create(run.id, run)) throw new Error('Request already exists.');
      if (decision.action === 'run' && closed) {
        return await change(run.id, current => {
          current.status = 'interrupted'; current.execution.completedAt = stamp();
          current.execution.error = 'The server stopped before this job could start. It was not executed.';
          current.execution.events.push({ state: 'interrupted', at: stamp() });
        });
      }
      if (decision.action === 'run') {
        const stop = new AbortController();
        const values = eia!.snapshot.observations.filter(row => row.metric === 'demand' && row.value !== null
          && Date.parse(row.window.endAt) <= Date.parse(decision.asOf)).map(row => row.value!);
        // Install ownership before starting; retries cannot launch this job a second time.
        const completion = Promise.resolve().then(() => execute(run, values, stop.signal));
        active.set(run.id, { stop, completion });
      }
      return structuredClone(run);
    } finally { publishing.delete(request.requestId); release(); }
  }
  return {
    submit, read,
    async waitForIdle() {
      await admission;
      await Promise.all([...active.values()].map(job => job.completion));
    },
    async context() {
      const [eia, caiso] = await Promise.all([feeds.eia.read(), feeds.caiso.read()]);
      return { mode, asOf: options.recordedAsOf ?? stamp(), inputs: { eia, caiso }, busy: active.size > 0 };
    },
    async close() {
      closed = true;
      await admission;
      for (const job of active.values()) job.stop.abort();
      await Promise.all([...active.values()].map(job => job.completion));
    },
  };
}
export type LocalRuns = ReturnType<typeof createLocalRuns>;
