import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { snapshotRevision } from './snapshotRevision.ts';
import type { SnapshotStore, SourceEvidence, StoredSnapshot } from './SnapshotStore.type.ts';
export type { SourceEvidence } from './SnapshotStore.type.ts';

type ArchiveRecord<T> = StoredSnapshot<T> & {
  schemaVersion: 1;
  feed: string;
  evidenceSha256: string;
};

const maxRecordBytes = 32 * 1024 * 1024;
const maxPointerBytes = 4096;
const digest = (json: string) => createHash('sha256').update(json).digest('hex');
const hasCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException | null)?.code === code;

function revisionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid archive revision');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid archive record');
  return value as Record<string, unknown>;
}

function sourceEvidence(value: unknown): SourceEvidence {
  const evidence = object(value);
  if (typeof evidence.format !== 'string' || !evidence.format.trim() || !Object.hasOwn(evidence, 'body')) throw new Error('Invalid archive source evidence');
  return { format: evidence.format, body: evidence.body };
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Archive content must be JSON serializable');
  return serialized;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error('Malformed archive JSON'); }
}

/** Reads only a bounded, regular file. A missing path is distinct from corrupt content. */
async function readJson(path: string, limit: number): Promise<unknown> {
  let file;
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Archive path must be a regular file');
    file = await open(path, 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Archive file exceeds size limit');
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size) throw new Error('Archive file changed during reading');
    return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  } finally {
    await file?.close();
  }
}

async function writeTemporary(directory: string, kind: string, content: string): Promise<string> {
  const path = join(directory, `.${kind}-${randomUUID()}.tmp`);
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    return path;
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}

/** Stores complete normalized publications and sanitized source evidence supplied by the collector. */
export function createSnapshotArchive<T>(directory: string, feed: string): SnapshotStore<T> {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Invalid archive directory');
  if (typeof feed !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(feed) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(feed)) throw new Error('Invalid archive feed');
  const root = resolve(directory);
  const feedDirectory = join(root, feed);
  const latestPath = join(feedDirectory, 'latest.json');
  const recordPath = (revision: string) => join(feedDirectory, `${revision}.json`);

  async function feedDirectoryExists(create = false): Promise<boolean> {
    if (create) {
      await mkdir(root, { recursive: true });
      await mkdir(feedDirectory).catch(error => { if (!hasCode(error, 'EEXIST')) throw error; });
    }
    try {
      const stat = await lstat(feedDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Archive feed must be a real directory');
      return true;
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false;
      throw error;
    }
  }

  function verifiedRecord(value: unknown, revision: string): StoredSnapshot<T> {
    const record = object(value);
    if (record.schemaVersion !== 1 || record.feed !== feed || record.revision !== revision || record.snapshot == null) throw new Error('Invalid archive record identity');
    if (snapshotRevision(record.snapshot) !== revision) throw new Error('Archive snapshot checksum mismatch');
    const evidence = sourceEvidence(record.evidence);
    revisionId(record.evidenceSha256);
    if (digest(json(evidence)) !== record.evidenceSha256) throw new Error('Archive source evidence checksum mismatch');
    return { revision, snapshot: record.snapshot as T, evidence };
  }

  async function read(revision: string): Promise<StoredSnapshot<T> | null> {
    revisionId(revision);
    if (!await feedDirectoryExists()) return null;
    const record = await readJson(recordPath(revision), maxRecordBytes);
    return record === undefined ? null : verifiedRecord(record, revision);
  }

  async function latest(): Promise<StoredSnapshot<T> | null> {
    if (!await feedDirectoryExists()) return null;
    const value = await readJson(latestPath, maxPointerBytes);
    if (value === undefined) return null;
    const pointer = object(value);
    if (pointer.schemaVersion !== 1 || pointer.feed !== feed) throw new Error('Invalid archive latest pointer');
    revisionId(pointer.revision);
    const record = await read(pointer.revision);
    if (!record) throw new Error('Archive latest pointer references a missing snapshot');
    return record;
  }

  async function publishLatest(revision: string): Promise<void> {
    const temporary = await writeTemporary(feedDirectory, 'latest', json({ schemaVersion: 1, feed, revision }));
    try {
      // A rename replaces the pointer atomically; record files use exclusive publication instead.
      await rename(temporary, latestPath);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function save(snapshot: T, evidence: SourceEvidence): Promise<string> {
    if (snapshot == null) throw new Error('Cannot archive an empty snapshot');
    const snapshotJson = json(snapshot);
    const normalizedSnapshot = parseJson(snapshotJson) as T;
    const evidenceJson = json(sourceEvidence(evidence));
    const revision = snapshotRevision(normalizedSnapshot);
    const record: ArchiveRecord<T> = {
      schemaVersion: 1, feed, revision, snapshot: normalizedSnapshot,
      evidence: sourceEvidence(parseJson(evidenceJson)), evidenceSha256: digest(evidenceJson),
    };
    const serialized = json(record);
    if (Buffer.byteLength(serialized, 'utf8') > maxRecordBytes) throw new Error('Archive record exceeds size limit');
    await feedDirectoryExists(true);
    const assertIdentical = (existing: StoredSnapshot<T>) => {
      if (json(existing.snapshot) !== snapshotJson || json(existing.evidence) !== evidenceJson) throw new Error('Archive revision already exists with different content');
    };
    const existing = await read(revision);
    if (existing) assertIdentical(existing);
    else {
      const temporary = await writeTemporary(feedDirectory, 'record', serialized);
      try {
        // Hard-link publication is atomic and cannot replace an existing revision, including on Windows.
        await link(temporary, recordPath(revision)).catch(async error => {
          if (!hasCode(error, 'EEXIST')) throw error;
          const winner = await read(revision);
          if (!winner) throw new Error('Archive revision disappeared during publication');
          assertIdentical(winner);
        });
      } finally {
        await unlink(temporary);
      }
    }
    await publishLatest(revision);
    return revision;
  }

  return { save, latest, read };
}
