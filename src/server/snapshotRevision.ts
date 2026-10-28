import { createHash } from 'node:crypto';

/** Shared identity for the complete normalized JSON publication, including retrieval provenance. */
export function snapshotRevision(snapshot: unknown): string {
  const serialized = JSON.stringify(snapshot);
  if (serialized === undefined) throw new Error('Snapshot must be JSON serializable');
  return createHash('sha256').update(serialized).digest('hex');
}
