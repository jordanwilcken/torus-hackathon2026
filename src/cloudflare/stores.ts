import { createHash } from 'node:crypto';
import type { SnapshotStore, SourceEvidence, StoredSnapshot } from '../server/SnapshotStore.type.ts';
import type { JobRunStore } from '../server/jobs/JobRunStore.type.ts';
import { snapshotRevision } from '../server/snapshotRevision.ts';
import type { SqliteStorage } from './storage.types.ts';

const digest = (content: string) => createHash('sha256').update(content).digest('hex');
// Keep row content below Cloudflare's 2 MB limit, with room for SQLite row overhead.
const maxRowBytes = 1_900_000;
const utf8 = new TextEncoder();
function assertRowSize(...values: string[]): void {
  if (values.reduce((size, value) => size + utf8.encode(value).byteLength, 0) > maxRowBytes) {
    throw new Error('Durable SQL row exceeds size limit');
  }
}

function serialize(value: unknown): string {
  const content = JSON.stringify(value);
  if (content === undefined) throw new Error('Stored content must be JSON serializable');
  return content;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored record');
  return value as Record<string, unknown>;
}

function revisionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid snapshot revision');
}

function sourceEvidence(value: unknown): SourceEvidence {
  const source = object(value);
  if (typeof source.format !== 'string' || !source.format.trim() || !Object.hasOwn(source, 'body')) {
    throw new Error('Invalid source evidence');
  }
  return { format: source.format, body: source.body };
}

/** One feed's immutable publications, sharing its Durable Object's SQLite database. */
export function createDurableSnapshotStore<T>(storage: SqliteStorage, feed: string): SnapshotStore<T> {
  if (typeof feed !== 'string' || !feed.trim()) throw new Error('Snapshot feed is required');
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS demo_snapshots (
      feed TEXT NOT NULL, revision TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      PRIMARY KEY (feed, revision)
    ) STRICT
  `).toArray();
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS demo_snapshot_heads (
      feed TEXT PRIMARY KEY, revision TEXT NOT NULL
    ) STRICT
  `).toArray();

  function read(revision: string): StoredSnapshot<T> | null {
    revisionId(revision);
    const row = storage.sql.exec('SELECT record_json FROM demo_snapshots WHERE feed = ? AND revision = ?', feed, revision).toArray()[0];
    if (!row) return null;
    if (typeof row.record_json !== 'string') throw new Error('Invalid stored snapshot');
    const record = object(JSON.parse(row.record_json));
    if (record.schemaVersion !== 1 || record.feed !== feed || record.revision !== revision || record.snapshot == null) {
      throw new Error('Invalid snapshot record identity');
    }
    if (snapshotRevision(record.snapshot) !== revision) throw new Error('Stored snapshot checksum mismatch');
    const evidence = sourceEvidence(record.evidence);
    revisionId(record.evidenceSha256);
    if (digest(serialize(evidence)) !== record.evidenceSha256) throw new Error('Stored source evidence checksum mismatch');
    return { revision, snapshot: record.snapshot as T, evidence };
  }

  return {
    async read(revision) { return read(revision); },
    async latest() {
      const head = storage.sql.exec('SELECT revision FROM demo_snapshot_heads WHERE feed = ?', feed).toArray()[0];
      if (!head) return null;
      revisionId(head.revision);
      const publication = read(head.revision);
      if (!publication) throw new Error('Latest publication references a missing snapshot');
      return publication;
    },
    async save(snapshot, evidence) {
      const snapshotJson = serialize(snapshot);
      const normalized = JSON.parse(snapshotJson);
      if (normalized == null) throw new Error('Cannot store an empty snapshot');
      const evidenceJson = serialize(sourceEvidence(evidence));
      const normalizedEvidence = sourceEvidence(JSON.parse(evidenceJson));
      const revision = snapshotRevision(normalized);
      const record = serialize({
        schemaVersion: 1, feed, revision, snapshot: normalized,
        evidence: normalizedEvidence, evidenceSha256: digest(evidenceJson),
      });
      assertRowSize(feed, revision, record);
      return storage.transactionSync(() => {
        storage.sql.exec(`
          INSERT INTO demo_snapshots (feed, revision, record_json) VALUES (?, ?, ?)
          ON CONFLICT(feed, revision) DO NOTHING
        `, feed, revision, record).toArray();
        const existing = read(revision);
        if (!existing || serialize(existing.snapshot) !== snapshotJson || serialize(existing.evidence) !== evidenceJson) {
          throw new Error('Snapshot revision already exists with different content');
        }
        storage.sql.exec(`
          INSERT INTO demo_snapshot_heads (feed, revision) VALUES (?, ?)
          ON CONFLICT(feed) DO UPDATE SET revision = excluded.revision
        `, feed, revision).toArray();
        return revision;
      });
    },
  };
}

/** Opaque job IDs and version compare-and-swap; the Durable Object owns connection lifetime. */
export function createDurableJobRunStore<T>(storage: SqliteStorage): JobRunStore<T> {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS demo_job_runs (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK (version >= 1),
      value_json TEXT NOT NULL CHECK (json_valid(value_json))
    ) STRICT
  `).toArray();

  return {
    async create(id, value) {
      const valueJson = serialize(value);
      assertRowSize(id, valueJson);
      return storage.sql.exec(`
        INSERT INTO demo_job_runs (id, version, value_json) VALUES (?, 1, ?)
        ON CONFLICT(id) DO NOTHING RETURNING id
      `, id, valueJson).toArray().length === 1;
    },
    async read(id) {
      const row = storage.sql.exec('SELECT version, value_json FROM demo_job_runs WHERE id = ?', id).toArray()[0];
      if (!row) return null;
      if (!Number.isSafeInteger(row.version) || Number(row.version) < 1 || typeof row.value_json !== 'string') {
        throw new Error('Invalid stored job record');
      }
      return { version: Number(row.version), value: JSON.parse(row.value_json) as T };
    },
    async update(id, expectedVersion, value) {
      const valueJson = serialize(value);
      assertRowSize(id, valueJson);
      return storage.sql.exec(`
        UPDATE demo_job_runs SET version = version + 1, value_json = ?
        WHERE id = ? AND version = ? RETURNING id
      `, valueJson, id, expectedVersion).toArray().length === 1;
    },
  };
}
