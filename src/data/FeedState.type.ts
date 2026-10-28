export type FeedState<T> = {
  status: 'ready' | 'stale' | 'unavailable';
  snapshot: T | null;
  /** SHA-256 of the normalized published snapshot JSON; null only when no snapshot exists. */
  revision: string | null;
  lastAttemptAt: string | null;
  nextRefreshAt: string | null;
  error?: string;
};
