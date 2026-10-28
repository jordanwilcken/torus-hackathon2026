import type { FeedState } from './FeedState.type';
import { publicFeedCadence } from './publicFeedCadence';

export type BrowserFeed<T> = Readonly<FeedState<T> & { loading: boolean }>;
export type FeedClient<T> = {
  /** Shared immutable state; capture this once to pin evidence for a decision. */
  getSnapshot(): BrowserFeed<T>;
  /** The first subscriber starts polling; the last departure cancels owned work. */
  subscribe(listener: () => void): () => void;
  /** Shares in-flight work and honors recovery cooldowns; cancellation publishes nothing. */
  refresh(): Promise<void>;
};

export function createFeedClient<T>(url: string, options: {
  fetcher?: typeof fetch; pollMs?: number; now?: () => number;
} = {}): FeedClient<T> {
  const { fetcher = fetch, pollMs = publicFeedCadence.browserPollMs, now = Date.now } = options;
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new RangeError('pollMs must be positive.');
  let state: BrowserFeed<T> = Object.freeze({ status: 'unavailable', snapshot: null, revision: null,
    lastAttemptAt: null, nextRefreshAt: null, loading: true });
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let notBefore = 0;
  let request: { controller: AbortController; promise: Promise<void> } | undefined;

  function publish(next: BrowserFeed<T>) {
    if (Object.keys(next).length === Object.keys(state).length &&
        Object.entries(next).every(([key, value]) => value === state[key as keyof BrowserFeed<T>])) return;
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error('Feed subscriber failed.', error); }
    }
  }

  // A retry replaces the next poll, so subscribers never create parallel schedules.
  function schedule(delay: number) {
    clearTimeout(timer);
    timer = undefined;
    if (!listeners.size) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, Math.min(delay, 2_147_483_647));
  }

  function scheduleNext(failure: unknown) {
    let delay = pollMs;
    if (failure instanceof TransientFeedError) {
      notBefore = retryAfterTime(failure.retryAfter, now());
      if (retries < 3) {
        delay = 1000 * 2 ** retries * (0.75 + Math.random() * 0.5);
        retries++;
        // Spread clients after Retry-After as well as after ordinary network failures.
        notBefore = Math.max(now(), notBefore) + delay;
      } else {
        retries = 0;
      }
    } else {
      retries = 0;
    }
    schedule(Math.max(delay, notBefore - now()));
  }

  function refresh(): Promise<void> {
    if (request) return request.promise;
    if (now() < notBefore) {
      schedule(notBefore - now());
      return Promise.resolve();
    }
    clearTimeout(timer);
    timer = undefined;
    notBefore = 0;
    const active = { controller: new AbortController(), promise: Promise.resolve() };
    request = active;
    let cancel!: () => void;
    const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
    active.controller.signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; active.controller.abort(); }, 15_000);
    active.promise = (async () => {
      let failure: unknown;
      try {
        const next = await Promise.race([readFeed<T>(url, fetcher, active.controller.signal), cancelled]);
        if (request !== active) return;
        if (timedOut) throw new TransientFeedError();
        if (!next) return;
        const retained = next.snapshot === null || next.revision === state.revision;
        const snapshot = retained ? state.snapshot : freeze(structuredClone(next.snapshot));
        publish({ ...next, snapshot, revision: retained ? state.revision : next.revision,
          status: next.status === 'unavailable' && snapshot !== null ? 'stale' : next.status, loading: false });
      } catch (error) {
        if (request !== active || (active.controller.signal.aborted && !timedOut)) return;
        failure = timedOut ? new TransientFeedError() : error;
        publish({ ...state, status: state.snapshot !== null ? 'stale' : 'unavailable', loading: false,
          lastAttemptAt: new Date(now()).toISOString(), nextRefreshAt: null,
          error: 'The feed request failed. The next check will retry.' });
      } finally {
        clearTimeout(deadline);
        active.controller.signal.removeEventListener('abort', cancel);
        if (request === active) {
          request = undefined;
          scheduleNext(failure);
        }
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
      if (listeners.size === 1) void refresh();
      return () => {
        if (!listeners.delete(subscription) || listeners.size) return;
        clearTimeout(timer);
        timer = undefined;
        retries = 0;
        const active = request;
        request = undefined;
        active?.controller.abort();
      };
    },
  };
}

class TransientFeedError extends Error {
  constructor(readonly retryAfter: string | null = null) { super('Feed request failed.'); }
}

function retryAfterTime(value: string | null, now: number): number {
  if (value === null) return 0;
  const time = /^\d+$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(time) ? Math.max(now, time) : 0;
}

async function readFeed<T>(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<FeedState<T>> {
  let response: Response;
  try {
    response = await fetcher(url, { signal, cache: 'no-store' });
  } catch {
    throw new TransientFeedError();
  }
  if ([429, 500, 502, 503, 504].includes(response.status)) {
    throw new TransientFeedError(response.headers.get('Retry-After'));
  }
  if (!response.ok) throw new Error('Feed request failed.');
  let value: FeedState<T>;
  try {
    value = await response.json() as FeedState<T>;
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new TransientFeedError();
  }
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
