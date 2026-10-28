export type StoredJob<T> = { version: number; value: T };

/**
 * Durable storage for JSON-compatible job records, keyed by an opaque caller-owned ID.
 * Successful create publishes version 1. Update compares the stored version atomically
 * and increments it only on success; duplicate create and missing/stale update return false.
 * Reads return independent values, or null only when the ID is absent. Storage failures reject.
 * The provider owns location, connection lifetime and durability; records are not deleted implicitly.
 */
export interface JobRunStore<T> {
  create(id: string, value: T): Promise<boolean>;
  read(id: string): Promise<StoredJob<T> | null>;
  update(id: string, expectedVersion: number, value: T): Promise<boolean>;
}
