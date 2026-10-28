import { useSyncExternalStore } from 'react';
import type { FeedClient } from '../../data/createFeedClient';

/** Pass the application-owned client so sibling views share requests and evidence. */
export function useFeed<T>(client: FeedClient<T>) {
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}
