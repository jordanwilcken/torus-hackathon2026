import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createDurableJobRunStore, createDurableSnapshotStore } from '../../../src/cloudflare/stores';
import type { SqliteStorage } from '../../../src/cloudflare/storage.types';
import eiaCapture from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import caisoCapture from '../../fixtures/public-grid/caiso.json' with { type: 'json' };

type Snapshot = { retrievedAt: string; observations: Array<{ value: number }> };
const captured = (): Snapshot => ({ retrievedAt: '2026-10-28T11:38:00.000Z', observations: [{ value: 5108 }] });
const evidence = () => ({ format: 'public-json', body: { values: [5108], retrievedAt: '2026-10-28T11:38:00.000Z' } });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let database: DatabaseSync;
let storage: SqliteStorage;

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  storage = {
    sql: { exec(query, ...bindings) {
      const rows = database.prepare(query).all(...bindings);
      return { toArray: () => rows };
    } },
    transactionSync(operation) {
      database.exec('BEGIN IMMEDIATE');
      try { const result = operation(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
});
afterEach(() => { if (database.isOpen) database.close(); });

test('a missing snapshot is absent, while an invalid revision rejects', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  expect(await store.latest()).toBeNull();
  expect(await store.read('a'.repeat(64))).toBeNull();
  await expect(store.read('../latest')).rejects.toThrow(/revision/i);
});

test('publishes the exact captured snapshot and source evidence without refreshing their timestamps', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const snapshot = captured();
  const source = evidence();
  const revision = await store.save(snapshot, source);
  expect(revision).toBe(digest(snapshot));
  expect(await store.read(revision)).toEqual({ revision, snapshot, evidence: source });
  expect(await store.latest()).toEqual({ revision, snapshot, evidence: source });
});

test('full captured EIA and CAISO publications retain their original revisions and evidence', async () => {
  const eia = createDurableSnapshotStore(storage, 'eia');
  const caiso = createDurableSnapshotStore(storage, 'caiso');
  expect(await eia.save(eiaCapture.snapshot, eiaCapture.evidence)).toBe(eiaCapture.revision);
  expect(await caiso.save(caisoCapture.snapshot, caisoCapture.evidence)).toBe(caisoCapture.revision);
  expect(await eia.latest()).toEqual({ revision: eiaCapture.revision, snapshot: eiaCapture.snapshot, evidence: eiaCapture.evidence });
  expect(await caiso.latest()).toEqual({ revision: caisoCapture.revision, snapshot: caisoCapture.snapshot, evidence: caisoCapture.evidence });
});

test('repeated saves are idempotent and latest means the last successful publication', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const first = await store.save(captured(), evidence());
  const second = await store.save({ ...captured(), retrievedAt: '2026-10-28T11:39:00.000Z' }, evidence());
  expect(second).not.toBe(first);
  expect((await store.latest())?.revision).toBe(second);
  expect(await store.save(captured(), evidence())).toBe(first);
  expect((await store.latest())?.revision).toBe(first);
  expect(await store.read(second)).not.toBeNull();
});

test('conflicting evidence cannot replace an immutable revision or advance latest', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const first = await store.save(captured(), evidence());
  const second = await store.save({ ...captured(), retrievedAt: '2026-10-28T11:39:00.000Z' }, evidence());
  await expect(store.save(captured(), { format: 'public-json', body: { values: [999] } })).rejects.toThrow(/different content/i);
  expect(await store.read(first)).toEqual({ revision: first, snapshot: captured(), evidence: evidence() });
  expect((await store.latest())?.revision).toBe(second);
});

test('a failed latest publication rolls back its new snapshot and retains the previous publication', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const first = await store.save(captured(), evidence());
  const next = { ...captured(), retrievedAt: '2026-10-28T11:39:00.000Z' };
  database.exec("CREATE TRIGGER reject_head BEFORE UPDATE ON demo_snapshot_heads BEGIN SELECT RAISE(ABORT, 'head publication failed'); END");
  await expect(store.save(next, evidence())).rejects.toThrow(/head publication failed/);
  expect((await store.latest())?.revision).toBe(first);
  expect(await store.read(digest(next))).toBeNull();
});

test('snapshot callers cannot mutate durable input, evidence or returned data', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const input = captured();
  const source = evidence();
  const revision = await store.save(input, source);
  input.observations[0].value = 1;
  source.body.values.push(2);
  const returned = await store.read(revision);
  returned!.snapshot.observations[0].value = 3;
  (returned!.evidence.body as { values: number[] }).values.push(4);
  expect(await store.latest()).toEqual({ revision, snapshot: captured(), evidence: evidence() });
});

test('feed keys isolate snapshots in the same database and construction preserves existing publications', async () => {
  const eia = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const quotedFeed = "feed'); DROP TABLE demo_snapshots; --";
  const other = createDurableSnapshotStore<Snapshot>(storage, quotedFeed);
  const revision = await eia.save(captured(), evidence());
  const otherSource = { format: 'other', body: { note: 'separate feed' } };
  await other.save(captured(), otherSource);
  expect((await eia.read(revision))?.evidence).toEqual(evidence());
  expect((await other.read(revision))?.evidence).toEqual(otherSource);
  const reopened = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  expect(await reopened.latest()).toEqual(await eia.latest());
});

test('a stored snapshot with changed content fails integrity checks on read and latest', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const revision = await store.save(captured(), evidence());
  database.prepare("UPDATE demo_snapshots SET record_json = json_set(record_json, '$.snapshot.observations[0].value', 999) WHERE feed = ? AND revision = ?").run('eia', revision);
  await expect(store.read(revision)).rejects.toThrow(/snapshot checksum/i);
  await expect(store.latest()).rejects.toThrow(/snapshot checksum/i);
});

test('changed source evidence and inconsistent record identity reject instead of returning data', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const revision = await store.save(captured(), evidence());
  database.prepare("UPDATE demo_snapshots SET record_json = json_set(record_json, '$.evidence.body.values[0]', 999) WHERE feed = ? AND revision = ?").run('eia', revision);
  await expect(store.read(revision)).rejects.toThrow(/evidence checksum/i);
  database.prepare("UPDATE demo_snapshots SET record_json = json_set(record_json, '$.feed', 'other') WHERE feed = ? AND revision = ?").run('eia', revision);
  await expect(store.read(revision)).rejects.toThrow(/identity/i);
});

test('a dangling latest pointer is corruption, not a missing feed', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  await store.save(captured(), evidence());
  database.prepare('UPDATE demo_snapshot_heads SET revision = ? WHERE feed = ?').run('b'.repeat(64), 'eia');
  await expect(store.latest()).rejects.toThrow(/missing snapshot/i);
});

test('invalid snapshot and source inputs do not replace the last valid publication', async () => {
  const store = createDurableSnapshotStore<unknown>(storage, 'eia');
  const revision = await store.save(captured(), evidence());
  await expect(store.save(null, evidence())).rejects.toThrow();
  await expect(store.save(undefined, evidence())).rejects.toThrow();
  await expect(store.save(captured(), { format: '', body: {} })).rejects.toThrow();
  await expect(store.save(captured(), { format: 'json', body: undefined })).rejects.toThrow();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await expect(store.save(circular, evidence())).rejects.toThrow();
  expect((await store.latest())?.revision).toBe(revision);
});

type Job = { state: string; at: string; values: number[]; output: { sum: number } | null };
const queued = (): Job => ({ state: 'queued', at: '2026-10-28T11:38:00.000Z', values: [3, 5], output: null });

test('publishes job version one once and duplicate creation cannot replace it', async () => {
  const store = createDurableJobRunStore<Job>(storage);
  expect(await store.create('job-1', queued())).toBe(true);
  expect(await store.create('job-1', { ...queued(), state: 'failed' })).toBe(false);
  expect(await store.read('job-1')).toEqual({ version: 1, value: queued() });
});

test('missing jobs stay absent on read and update', async () => {
  const store = createDurableJobRunStore<Job>(storage);
  expect(await store.read('missing')).toBeNull();
  expect(await store.update('missing', 1, queued())).toBe(false);
  expect(await store.read('missing')).toBeNull();
});

test('a matching job version advances once and stale writers cannot replace the outcome', async () => {
  const store = createDurableJobRunStore<Job>(storage);
  await store.create('job-1', queued());
  const completed = { ...queued(), state: 'done', output: { sum: 8 } };
  expect(await store.update('job-1', 1, completed)).toBe(true);
  expect(await store.update('job-1', 1, { ...queued(), state: 'failed' })).toBe(false);
  expect(await store.read('job-1')).toEqual({ version: 2, value: completed });
});

test('two job adapters share one create winner and one compare-and-swap winner', async () => {
  const first = createDurableJobRunStore<Job>(storage);
  const second = createDurableJobRunStore<Job>(storage);
  expect(await Promise.all([first.create('job-1', queued()), second.create('job-1', queued())])).toEqual([true, false]);
  const done = { ...queued(), state: 'done', output: { sum: 8 } };
  const failed = { ...queued(), state: 'failed' };
  expect(await Promise.all([first.update('job-1', 1, done), second.update('job-1', 1, failed)])).toEqual([true, false]);
  expect(await second.read('job-1')).toEqual({ version: 2, value: done });
});

test('job input and read objects are detached and reconstruction preserves timestamp and output', async () => {
  const store = createDurableJobRunStore<Job>(storage);
  const input = queued();
  await store.create('job-1', input);
  input.values.push(900);
  (await store.read('job-1'))!.value.values.push(800);
  expect(await store.read('job-1')).toEqual({ version: 1, value: queued() });
  const completed = { ...queued(), state: 'done', output: { sum: 8 } };
  await store.update('job-1', 1, completed);
  completed.output.sum = 999;
  const reopened = createDurableJobRunStore<Job>(storage);
  expect(await reopened.read('job-1')).toEqual({ version: 2, value: { ...queued(), state: 'done', output: { sum: 8 } } });
});

test('opaque job identifiers remain literal SQL bindings alongside snapshot tables', async () => {
  const snapshots = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const revision = await snapshots.save(captured(), evidence());
  const store = createDurableJobRunStore<Job>(storage);
  const id = "job'); DROP TABLE demo_job_runs; --";
  expect(await store.create(id, queued())).toBe(true);
  expect(await store.read(id)).toEqual({ version: 1, value: queued() });
  expect((await snapshots.latest())?.revision).toBe(revision);
});

test('unserializable job input fails without publishing or advancing a version', async () => {
  const store = createDurableJobRunStore<Job>(storage);
  await expect(store.create('missing', undefined as unknown as Job)).rejects.toThrow();
  expect(await store.read('missing')).toBeNull();
  await store.create('job-1', queued());
  const circular = queued();
  Object.assign(circular, { self: circular });
  await expect(store.update('job-1', 1, circular)).rejects.toThrow();
  expect(await store.read('job-1')).toEqual({ version: 1, value: queued() });
});

test('storage failures reject reads and writes instead of masquerading as absent data', async () => {
  const snapshots = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const jobs = createDurableJobRunStore<Job>(storage);
  database.close();
  await expect(snapshots.read('a'.repeat(64))).rejects.toThrow();
  await expect(snapshots.latest()).rejects.toThrow();
  await expect(snapshots.save(captured(), evidence())).rejects.toThrow();
  await expect(jobs.read('job-1')).rejects.toThrow();
  await expect(jobs.create('job-1', queued())).rejects.toThrow();
  await expect(jobs.update('job-1', 1, queued())).rejects.toThrow();
});

test('oversized UTF-8 snapshot evidence rejects before publishing and keeps the previous latest', async () => {
  const store = createDurableSnapshotStore<Snapshot>(storage, 'eia');
  const previous = await store.save(captured(), evidence());
  const next = { ...captured(), retrievedAt: '2026-10-28T11:40:00.000Z' };
  await expect(store.save(next, { format: 'large-json', body: 'é'.repeat(960_000) })).rejects.toThrow(/size limit/i);
  expect((await store.latest())?.revision).toBe(previous);
  expect(await store.read(digest(next))).toBeNull();
});

test('oversized job records reject without creating a job or advancing an existing version', async () => {
  const store = createDurableJobRunStore<unknown>(storage);
  await store.create('job-1', queued());
  const oversized = { output: 'é'.repeat(960_000) };
  await expect(store.create('too-large', oversized)).rejects.toThrow(/size limit/i);
  await expect(store.update('job-1', 1, oversized)).rejects.toThrow(/size limit/i);
  expect(await store.read('too-large')).toBeNull();
  expect(await store.read('job-1')).toEqual({ version: 1, value: queued() });
});
