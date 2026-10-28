/** Sanitized source material retained alongside a normalized snapshot. */
export type SourceEvidence = { format: string; body: unknown };

export type StoredSnapshot<T> = {
  revision: string;
  snapshot: T;
  evidence: SourceEvidence;
};

/**
 * Each store instance represents one feed's normalized, non-null JSON snapshots and source evidence.
 * The provider binds the feed, storage location and any authentication at construction.
 * Revisions are lowercase SHA-256 digests of JSON.stringify(snapshot), including the
 * original timestamps. Storage never replaces observation or retrieval times with read times.
 *
 * Publications are immutable. Saving the same snapshot and evidence is idempotent;
 * different content for an existing revision rejects without overwriting it. Latest
 * advances only after a successful durable save; a failed save preserves the previous latest publication.
 *
 * Reads return independent values, including nested snapshot and evidence data. Null
 * means genuinely absent; unreadable, corrupt or inconsistent stored data rejects.
 * Backend record schemas, keys, checksums and connection details remain provider-owned.
 */
export interface SnapshotStore<T> {
  save(snapshot: T, evidence: SourceEvidence): Promise<string>;
  latest(): Promise<StoredSnapshot<T> | null>;
  read(revision: string): Promise<StoredSnapshot<T> | null>;
}
