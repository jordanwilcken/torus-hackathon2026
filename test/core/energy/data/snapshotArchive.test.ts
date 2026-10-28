import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createSnapshotArchive } from '../../../../src/server/snapshotArchive';
import type { SourceEvidence } from '../../../../src/server/snapshotArchive';

type Reading = { retrievedAt: string; value: number };
const first: Reading = { retrievedAt: '2026-10-28T08:00:00Z', value: 5429 };
const second: Reading = { retrievedAt: '2026-10-28T08:00:00Z', value: 5500 };
const evidence: SourceEvidence = { format: 'application/json', body: { value: '5429' } };
// Independently calculated SHA-256 values for the literal normalized JSON examples.
const firstRevision = '7b046b7111e429cae6e07609f49d9d07e39726881e5f04c8f3ec87e3b15cb79f';
const secondRevision = '81f0ba63c6644fe0a7cf09365ddc4f33062b99805186046cf483698fb5d4cf3c';
const evidenceSha256 = '627da2fc54a3b4799efbcd2f3ea201696ea8add9fe6a0b0e9880e8b073eec275';
let directory: string;

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'sunchaser-archive-test-')); });
afterEach(async () => {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('sunchaser-archive-test-')) throw new Error('Refusing to remove an unowned test directory');
  await rm(target, { recursive: true, force: true });
});

const recordPath = (revision: string) => join(directory, 'eia', `${revision}.json`);
const latestPath = () => join(directory, 'eia', 'latest.json');

test('a genuinely missing archive returns no latest publication or requested revision', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  expect(await archive.latest()).toBeNull();
  expect(await archive.read(firstRevision)).toBeNull();
});

test('persists exact normalized and source evidence with independent checksums across restart', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  expect(await archive.save(first, evidence)).toBe(firstRevision);
  expect(await archive.latest()).toEqual({ schemaVersion: 1, feed: 'eia', revision: firstRevision, snapshot: first, evidence, evidenceSha256 });
  expect(await archive.save(second, { format: 'text/csv', body: 'value\n5500\n' })).toBe(secondRevision);

  const restarted = createSnapshotArchive<Reading>(directory, 'eia');
  expect(await restarted.read(firstRevision)).toMatchObject({ revision: firstRevision, snapshot: first, evidence });
  expect(await restarted.latest()).toMatchObject({ revision: secondRevision, snapshot: second, evidence: { format: 'text/csv', body: 'value\n5500\n' } });
});

test('re-saving identical evidence is idempotent but conflicting evidence cannot overwrite the revision', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  const originalBytes = await readFile(recordPath(firstRevision), 'utf8');
  expect(await archive.save({ ...first }, structuredClone(evidence))).toBe(firstRevision);
  await expect(archive.save(first, { format: 'application/json', body: { value: 'DIFFERENT' } })).rejects.toThrow();
  expect(await readFile(recordPath(firstRevision), 'utf8')).toBe(originalBytes);
  expect(await archive.latest()).toMatchObject({ revision: firstRevision, snapshot: first, evidence });
});

test('concurrent identical writers publish one immutable record and a complete latest pointer', async () => {
  const one = createSnapshotArchive<Reading>(directory, 'eia');
  const two = createSnapshotArchive<Reading>(directory, 'eia');
  expect(await Promise.all([one.save(first, evidence), two.save(first, evidence)])).toEqual([firstRevision, firstRevision]);
  expect(await one.latest()).toMatchObject({ revision: firstRevision, snapshot: first, evidence });
  expect((await readdir(join(directory, 'eia'))).sort()).toEqual([`${firstRevision}.json`, 'latest.json'].sort());
});

test.each([
  ['snapshot bytes', 'snapshot', { ...first, value: 0 }],
  ['evidence bytes', 'evidence', { format: 'application/json', body: { value: '0' } }],
  ['schema version', 'schemaVersion', 2],
  ['feed identity', 'feed', 'caiso'],
  ['revision identity', 'revision', secondRevision],
  ['evidence checksum', 'evidenceSha256', '0'.repeat(64)],
] as const)('rejects corrupted %s instead of returning a latest success', async (_label, field, replacement) => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  const record = JSON.parse(await readFile(recordPath(firstRevision), 'utf8')) as Record<string, unknown>;
  record[field] = replacement;
  await writeFile(recordPath(firstRevision), JSON.stringify(record));
  await expect(archive.read(firstRevision)).rejects.toThrow();
  await expect(archive.latest()).rejects.toThrow();
});

test('a dangling latest pointer fails while an explicitly missing revision returns null', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  await unlink(recordPath(firstRevision));
  expect(await archive.read(firstRevision)).toBeNull();
  await expect(archive.latest()).rejects.toThrow();
});

test.each(['{', 'null', JSON.stringify({ schemaVersion: 1, feed: 'eia', revision: '../escape' }), JSON.stringify({ schemaVersion: 1, feed: 'caiso', revision: firstRevision })])('rejects malformed or misidentified latest pointer %s', async pointer => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  await writeFile(latestPath(), pointer);
  await expect(archive.latest()).rejects.toThrow();
});

test.each(['{', 'null'])('rejects malformed record %s instead of treating it as missing', async content => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  await writeFile(recordPath(firstRevision), content);
  await expect(archive.read(firstRevision)).rejects.toThrow();
});

test('partial temporary files and orphan records never become latest implicitly', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  await unlink(latestPath());
  await writeFile(join(directory, 'eia', '.record-interrupted.tmp'), '{');
  await writeFile(join(directory, 'eia', '.latest-interrupted.tmp'), JSON.stringify({ schemaVersion: 1, feed: 'eia', revision: firstRevision }));
  expect(await archive.latest()).toBeNull();
  expect(await archive.read(firstRevision)).toMatchObject({ snapshot: first });
});

test('a blocked record publication fails and preserves the previous latest revision', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  await mkdir(recordPath(secondRevision));
  await expect(archive.save(second, { format: 'text/csv', body: 'value\n5500\n' })).rejects.toThrow();
  expect(await archive.latest()).toMatchObject({ revision: firstRevision, snapshot: first });
  expect((await readdir(join(directory, 'eia'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

test('refuses oversized archive files before parsing them', async () => {
  const archive = createSnapshotArchive<Reading>(directory, 'eia');
  await archive.save(first, evidence);
  const file = await open(recordPath(firstRevision), 'w');
  try { await file.truncate(32 * 1024 * 1024 + 1); } finally { await file.close(); }
  await expect(archive.read(firstRevision)).rejects.toThrow(/size|limit/i);
});

test.each(['', '..', '../outside', 'a/b', 'a\\b', 'C:escape', 'CON', 'nul', 'eia.'])('rejects unsafe feed path %j', feed => {
  expect(() => createSnapshotArchive(directory, feed)).toThrow();
});

test.each(['../outside', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)])('rejects unsafe revision path %j', async revision => {
  await expect(createSnapshotArchive(directory, 'eia').read(revision)).rejects.toThrow();
});

test('refuses a feed directory junction that redirects outside the archive root', async () => {
  const root = join(directory, 'archive');
  const outside = join(directory, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await symlink(outside, join(root, 'eia'), 'junction');
  const archive = createSnapshotArchive<Reading>(root, 'eia');
  await expect(archive.save(first, evidence)).rejects.toThrow();
  await expect(archive.latest()).rejects.toThrow();
  expect(await readdir(outside)).toEqual([]);
});
