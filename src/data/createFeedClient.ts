import type { FeedState } from './FeedState.type';

export type BrowserFeed<T> = Readonly<FeedState<T> & { loading: boolean }>;
export type FeedClient<T> = {
  /** Shared immutable state; capture this once to pin evidence for a decision. */
  getSnapshot(): BrowserFeed<T>;
  /** The first subscriber starts polling; the last departure cancels owned work. */
  subscribe(listener: () => void): () => void;
  /** Resolves after publishing success/failure; cancellation publishes nothing. */
  refresh(): Promise<void>;
};

export function createFeedClient<T>(url: string, options: {
  fetcher?: typeof fetch; pollMs?: number; now?: () => number;
} = {}): FeedClient<T> {
  const { fetcher = fetch, pollMs = 60_000, now = Date.now } = options;
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new RangeError('pollMs must be positive.');
  let state: BrowserFeed<T> = Object.freeze({ status: 'unavailable', snapshot: null, revision: null,
    lastAttemptAt: null, nextRefreshAt: null, loading: true });
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let request: { controller: AbortController; promise: Promise<void> } | undefined;

  function publish(next: BrowserFeed<T>) {
    if (Object.keys(next).length === Object.keys(state).length &&
        Object.entries(next).every(([key, value]) => value === state[key as keyof BrowserFeed<T>])) return;
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error('Feed subscriber failed.', error); }
    }
  }

  function refresh(): Promise<void> {
    if (request) return request.promise;
    const active = { controller: new AbortController(), promise: Promise.resolve() };
    request = active;
    let cancel!: () => void;
    const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
    active.controller.signal.addEventListener('abort', cancel, { once: true });
    active.promise = (async () => {
      try {
        const next = await Promise.race([readFeed<T>(url, fetcher, active.controller.signal), cancelled]);
        if (!next || request !== active) return;
        const retained = next.snapshot === null || next.revision === state.revision;
        const snapshot = retained ? state.snapshot : freeze(structuredClone(next.snapshot));
        publish({ ...next, snapshot, revision: retained ? state.revision : next.revision,
          status: next.status === 'unavailable' && snapshot !== null ? 'stale' : next.status, loading: false });
      } catch {
        if (request !== active || active.controller.signal.aborted) return;
        publish({ ...state, status: state.snapshot !== null ? 'stale' : 'unavailable', loading: false,
          lastAttemptAt: new Date(now()).toISOString(), nextRefreshAt: null,
          error: 'The feed request failed. The next check will retry.' });
      } finally {
        active.controller.signal.removeEventListener('abort', cancel);
        if (request === active) request = undefined;
      }
    })();
    return active.promise;
  }

  return {
    getSnapshot: () => state,
    refresh,
    subscribe(listener) {
      const subscription = () => listener();
      listeners.add(subscription);
      if (listeners.size === 1) {
        timer = setInterval(() => { void refresh(); }, pollMs);
        void refresh();
      }
      return () => {
        if (!listeners.delete(subscription) || listeners.size) return;
        clearInterval(timer);
        timer = undefined;
        const active = request;
        request = undefined;
        active?.controller.abort();
      };
    },
  };
}

async function readFeed<T>(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<FeedState<T>> {
  const response = await fetcher(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Feed request failed.');
  const value = await response.json() as FeedState<T>;
  const time = (input: unknown) => input === null || typeof input === 'string' && Number.isFinite(Date.parse(input));
  if (!value || !['ready', 'stale', 'unavailable'].includes(value.status) || value.snapshot === undefined ||
      !time(value.lastAttemptAt) || !time(value.nextRefreshAt) ||
      (value.error !== undefined && typeof value.error !== 'string') ||
      (value.snapshot === null ? value.revision !== null || value.status !== 'unavailable'
        : typeof value.revision !== 'string' || !value.revision || value.status === 'unavailable')) {
    throw new Error('Invalid feed publication.');
  }
  return { status: value.status, snapshot: value.snapshot, revision: value.revision,
    lastAttemptAt: value.lastAttemptAt, nextRefreshAt: value.nextRefreshAt,
    ...(value.error === undefined ? {} : { error: value.error }) };
}

/** Only owned JSON data reaches this boundary; never freeze a caller's objects. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
