import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSnapshotArchive } from './snapshotArchive.ts';
import { createGridApi } from './gridApi.ts';
import { createGridFeeds, createRecordedGridFeeds } from './gridFeeds.ts';
import { createLocalRuns } from './jobs/localRuns.ts';
import { nodeWorkloadExecutor } from './jobs/localWorker.ts';
import { createJobsApi } from './jobs/jobsApi.ts';
import { createSqliteJobRunStore } from './jobs/sqliteJobRunStore.ts';
import type { LocalRun } from '../data/LocalRun.type.ts';
import { parseEiaApiResponse, type EiaApiSnapshot } from '../core/energy/data/eiaApi.ts';
import { parseCaisoCsv, type CaisoSnapshot } from './caiso.ts';
import type { StoredSnapshot } from './SnapshotStore.type.ts';
import { snapshotRevision } from './snapshotRevision.ts';

export type ApplicationOptions = {
  apiKey: string;
  archiveDirectory: string;
  runDirectory: string;
  offline?: boolean;
  publicOrigin?: string;
  recorded?: { asOf: string; eia: StoredSnapshot<EiaApiSnapshot>; caiso: StoredSnapshot<CaisoSnapshot> };
};

/** One owner for the feeds, archives, worker and run database, independent of the HTTP host. */
export async function createApplication(options: ApplicationOptions) {
  await mkdir(resolve(options.runDirectory), { recursive: true });
  const stores = {
    eia: createSnapshotArchive<EiaApiSnapshot>(options.archiveDirectory, 'eia'),
    caiso: createSnapshotArchive<CaisoSnapshot>(options.archiveDirectory, 'caiso'),
  };
  if (options.recorded) {
    const eiaBody = options.recorded.eia.evidence.body as { response: unknown; retrievedAt: string };
    const eia = parseEiaApiResponse({ response: eiaBody.response }, eiaBody.retrievedAt);
    const caisoBody = options.recorded.caiso.evidence.body as { csv: string; retrievedAt: string };
    const caiso = parseCaisoCsv(caisoBody.csv, caisoBody.retrievedAt);
    if (snapshotRevision(eia) !== options.recorded.eia.revision || snapshotRevision(caiso) !== options.recorded.caiso.revision) throw new Error('Captured public evidence does not reproduce its revision');
    await stores.eia.save(eia, options.recorded.eia.evidence);
    await stores.caiso.save(caiso, options.recorded.caiso.evidence);
  }
  const feeds = options.recorded ? createRecordedGridFeeds(stores)
    : createGridFeeds(options.apiKey, stores, { offline: options.offline });
  const runStore = createSqliteJobRunStore<LocalRun>(join(options.runDirectory, 'runs.sqlite'));
  const jobs = createLocalRuns({ executor: nodeWorkloadExecutor, store: runStore, snapshots: stores, feeds, recordedAsOf: options.recorded?.asOf });
  const gridApi = createGridApi(options.apiKey, stores, { feeds, offline: options.offline && !options.recorded });
  const jobsApi = createJobsApi(jobs, { publicOrigin: options.publicOrigin });
  let closing: Promise<void> | undefined;
  return {
    handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
      gridApi(request, response, () => jobsApi(request, response, next));
    },
    close() {
      return closing ??= jobs.close().finally(() => runStore.close());
    },
  };
}
