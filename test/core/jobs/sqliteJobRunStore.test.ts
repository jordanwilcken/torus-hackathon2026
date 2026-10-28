import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createSqliteJobRunStore } from '../../../src/server/jobs/sqliteJobRunStore';

type Run = { state: string; requestedAt: string; values: number[]; output: { sum: number } | null };
const requestedAt = '2026-10-28T10:00:00.000Z';
const queued = (): Run => ({ state: 'queued', requestedAt, values: [3, 5], output: null });
let directory: string;
let filename: string;
let stores: Array<{ close(): void }>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sunchaser-job-store-test-'));
  filename = join(directory, 'runs.sqlite');
  stores = [];
});

afterEach(async () => {
  for (const store of stores) store.close();
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('sunchaser-job-store-test-')) throw new Error('Refusing to remove an unowned test directory');
  await rm(target, { recursive: true, force: true });
});

function openStore() {
  const store = createSqliteJobRunStore<Run>(filename);
  stores.push(store);
  return store;
}

test('creates version one once and never replaces a job on duplicate submission', async () => {
  const store = openStore();
  const submitted = queued();
  expect(await store.create('job-1', submitted)).toBe(true);
  expect(await store.create('job-1', { ...submitted, state: 'replaced' })).toBe(false);
  expect(await store.read('job-1')).toEqual({ version: 1, value: submitted });
});

test('missing reads and updates leave the job absent', async () => {
  const store = openStore();
  expect(await store.read('missing')).toBeNull();
  expect(await store.update('missing', 1, queued())).toBe(false);
  expect(await store.read('missing')).toBeNull();
});

test('a matching version advances once and a stale writer cannot replace that outcome', async () => {
  const store = openStore();
  await store.create('job-1', queued());
  const completed = { ...queued(), state: 'completed', output: { sum: 8 } };
  expect(await store.update('job-1', 1, completed)).toBe(true);
  expect(await store.update('job-1', 1, { ...queued(), state: 'failed' })).toBe(false);
  expect(await store.read('job-1')).toEqual({ version: 2, value: completed });
});

test('reopening the database recovers the same version, output and original timestamps', async () => {
  const first = openStore();
  await first.create('job-1', queued());
  const completed = { ...queued(), state: 'completed', output: { sum: 8 } };
  await first.update('job-1', 1, completed);
  first.close();

  const restarted = openStore();
  expect(await restarted.read('job-1')).toEqual({ version: 2, value: completed });
  expect(await restarted.create('job-1', queued())).toBe(false);
});

test('two store instances agree on one create winner and one update winner', async () => {
  const first = openStore();
  const second = openStore();
  const created = await Promise.all([first.create('job-1', queued()), second.create('job-1', queued())]);
  expect(created.filter(Boolean)).toHaveLength(1);
  expect(await first.read('job-1')).toEqual({ version: 1, value: queued() });
  expect(await second.read('job-1')).toEqual({ version: 1, value: queued() });

  const completed = { ...queued(), state: 'completed', output: { sum: 8 } };
  const failed = { ...queued(), state: 'failed' };
  const updated = await Promise.all([first.update('job-1', 1, completed), second.update('job-1', 1, failed)]);
  expect(updated.filter(Boolean)).toHaveLength(1);
  const winner = updated[0] ? completed : failed;
  expect(await first.read('job-1')).toEqual({ version: 2, value: winner });
  expect(await second.read('job-1')).toEqual({ version: 2, value: winner });
});

test('mutating submitted or returned objects cannot alter the durable record', async () => {
  const store = openStore();
  const submitted = queued();
  await store.create('job-1', submitted);
  submitted.values[0] = 100;
  const observed = await store.read('job-1');
  observed!.value.values.push(900);
  expect(await store.read('job-1')).toEqual({ version: 1, value: queued() });

  const completed = { ...queued(), state: 'completed', output: { sum: 8 } };
  await store.update('job-1', 1, completed);
  completed.output.sum = 999;
  expect(await store.read('job-1')).toEqual({ version: 2, value: { ...queued(), state: 'completed', output: { sum: 8 } } });
});

test('quoted identifiers are literal keys and cannot change other job records', async () => {
  const store = openStore();
  const id = "job'); DROP TABLE job_runs; --";
  expect(await store.create(id, queued())).toBe(true);
  expect(await store.create('ordinary-job', { ...queued(), values: [12] })).toBe(true);
  expect(await store.read(id)).toEqual({ version: 1, value: queued() });
  expect(await store.read('ordinary-job')).toEqual({ version: 1, value: { ...queued(), values: [12] } });
});

test('unserializable values fail without publishing or changing the previous version', async () => {
  const store = openStore();
  await expect(store.create('missing', undefined as unknown as Run)).rejects.toThrow();
  expect(await store.read('missing')).toBeNull();
  await store.create('job-1', queued());
  const circular = queued();
  Object.assign(circular, { self: circular });
  await expect(store.update('job-1', 1, circular)).rejects.toThrow();
  expect(await store.read('job-1')).toEqual({ version: 1, value: queued() });
});
