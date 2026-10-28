import { createHash } from 'node:crypto';
import type { FeedState } from '../data/FeedState.type.ts';
export type { FeedState } from '../data/FeedState.type.ts';

export class FeedError extends Error {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Publishes normalized, JSON-serializable snapshots. Concurrent readers share the same refresh. */
export function createCachedFeed<T>(
  collect: () => Promise<T>,
  refreshMs: number,
  now: () => number = Date.now,
) {
  let state: FeedState<T> = { status: 'unavailable', snapshot: null, revision: null, lastAttemptAt: null, nextRefreshAt: null };
  let pending: Promise<void> | undefined;
  return {
    async read(): Promise<FeedState<T>> {
      if (!pending && (!state.nextRefreshAt || now() >= Date.parse(state.nextRefreshAt))) {
        state.lastAttemptAt = new Date(now()).toISOString();
        pending = (async () => {
          try {
            const snapshot = structuredClone(await collect());
            if (snapshot == null) throw new Error('Collector returned no snapshot');
            const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
            state = { status: 'ready', snapshot, revision, lastAttemptAt: state.lastAttemptAt,
              nextRefreshAt: new Date(now() + refreshMs).toISOString() };
          } catch (error) {
            const delay = error instanceof FeedError ? error.retryAfterMs ?? 300_000 : 300_000;
            state = { ...state, status: state.snapshot !== null ? 'stale' : 'unavailable',
              error: error instanceof FeedError ? error.message : 'Feed refresh failed; no replacement data was invented.',
              nextRefreshAt: new Date(now() + Math.max(60_000, delay)).toISOString() };
          }
        })().finally(() => { pending = undefined; });
      }
      await pending;
      return structuredClone(state);
    },
  };
}
