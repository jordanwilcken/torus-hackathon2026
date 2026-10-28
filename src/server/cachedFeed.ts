import { snapshotRevision } from './snapshotRevision.ts';
import type { FeedState } from '../data/FeedState.type.ts';
export type { FeedState } from '../data/FeedState.type.ts';

export class FeedError extends Error {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Publishes normalized JSON snapshots; restoration and refresh are singleflight. */
export function createCachedFeed<T>(
  collect: () => Promise<T>,
  refreshMs: number,
  now: () => number = Date.now,
  restore?: () => Promise<T | null>,
  retrievedAt?: (snapshot: T) => number,
) {
  let state: FeedState<T> = { status: 'unavailable', snapshot: null, revision: null, lastAttemptAt: null, nextRefreshAt: null };
  let pending: Promise<void> | undefined;
  let initialization: Promise<void> | undefined;
  let restorationFailed = false;
  const publication = (value: T) => {
    const snapshot = structuredClone(value);
    if (snapshot == null) throw new Error('Collector returned no snapshot');
    return { snapshot, revision: snapshotRevision(snapshot) };
  };
  const initialize = () => initialization ??= (async () => {
    try {
      const snapshot = await restore?.();
      if (snapshot != null) {
        const saved = publication(snapshot);
        const collectedAt = retrievedAt?.(saved.snapshot) ?? NaN;
        const currentTime = now();
        const nextRefresh = collectedAt + refreshMs;
        // A restart retains the original refresh deadline, never renews old evidence.
        const fresh = collectedAt <= currentTime && currentTime < nextRefresh;
        state = { ...state, ...saved, status: fresh ? 'ready' : 'stale',
          nextRefreshAt: fresh ? new Date(nextRefresh).toISOString() : null };
      }
    } catch { restorationFailed = true; }
  })();
  return {
    async read(): Promise<FeedState<T>> {
      await initialize();
      if (!pending && (!state.nextRefreshAt || now() >= Date.parse(state.nextRefreshAt))) {
        state.lastAttemptAt = new Date(now()).toISOString();
        pending = (async () => {
          try {
            const collected = publication(await collect());
            state = { status: 'ready', ...collected, lastAttemptAt: state.lastAttemptAt,
              nextRefreshAt: new Date(now() + refreshMs).toISOString() };
            restorationFailed = false;
          } catch (error) {
            const delay = error instanceof FeedError ? error.retryAfterMs ?? 300_000 : 300_000;
            const message = error instanceof FeedError ? error.message : 'Feed refresh failed; no replacement data was invented.';
            state = { ...state, status: state.snapshot !== null ? 'stale' : 'unavailable',
              error: (restorationFailed ? 'Saved snapshot could not be loaded. ' : '') + message,
              nextRefreshAt: new Date(now() + Math.max(60_000, delay)).toISOString() };
          }
        })().finally(() => { pending = undefined; });
      }
      await pending;
      return structuredClone(state);
    },
  };
}
