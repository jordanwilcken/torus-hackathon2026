import { DatabaseSync } from 'node:sqlite';
import type { JobRunStore } from './JobRunStore.type.ts';

function serialize(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Job records must be JSON-compatible');
  return json;
}

export function createSqliteJobRunStore<T>(filename: string): JobRunStore<T> & { close(): void } {
  const database = new DatabaseSync(filename, { timeout: 5_000 });
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL CHECK (version >= 1),
        value_json TEXT NOT NULL CHECK (json_valid(value_json))
      ) STRICT;
    `);
    const create = database.prepare(`
      INSERT INTO job_runs (id, version, value_json) VALUES (?, 1, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const read = database.prepare('SELECT version, value_json FROM job_runs WHERE id = ?');
    const update = database.prepare(`
      UPDATE job_runs SET version = version + 1, value_json = ?
      WHERE id = ? AND version = ?
    `);
    let closed = false;

    return {
      async create(id, value) {
        return create.run(id, serialize(value)).changes === 1;
      },
      async read(id) {
        const row = read.get(id);
        if (!row) return null;
        return { version: Number(row.version), value: JSON.parse(row.value_json as string) as T };
      },
      async update(id, expectedVersion, value) {
        return update.run(serialize(value), id, expectedVersion).changes === 1;
      },
      close() {
        if (closed) return;
        database.close();
        closed = true;
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
