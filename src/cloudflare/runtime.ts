import type { LocalRun } from '../data/LocalRun.type.ts';
import type { EiaApiSnapshot } from '../core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from '../server/caiso.ts';
import { createGridFeeds, type GridFeeds } from '../server/gridFeeds.ts';
import { createLocalRuns } from '../server/jobs/localRuns.ts';
import { edgeWorkloadExecutor } from '../server/jobs/edgeWorkloadExecutor.ts';
import { createDurableJobRunStore, createDurableSnapshotStore } from './stores.ts';
import type { SqliteStorage } from './storage.types.ts';
import { handleDemoApi } from './http.ts';

/** The durable object owns one application. Tests can supply original-timestamp recorded feeds through the same contracts. */
export function createDemoRuntime(storage: SqliteStorage, options: {
  apiKey: string;
  waitUntil(promise: Promise<void>): void;
  feeds?: GridFeeds;
  recordedAsOf?: string;
}) {
  const stores = {
    eia: createDurableSnapshotStore<EiaApiSnapshot>(storage, 'eia'),
    caiso: createDurableSnapshotStore<CaisoSnapshot>(storage, 'caiso'),
  };
  const feeds = options.feeds ?? createGridFeeds(options.apiKey, stores);
  const jobs = createLocalRuns({ store: createDurableJobRunStore<LocalRun>(storage), snapshots: stores, feeds,
    executor: edgeWorkloadExecutor, recordedAsOf: options.recordedAsOf });
  return {
    stores, jobs,
    fetch(request: Request) { return handleDemoApi(request, { stores, feeds, jobs, waitUntil: options.waitUntil }); },
  };
}
