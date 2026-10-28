import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { createSnapshotArchive } from './snapshotArchive.ts';
import { createGridApi } from './gridApi.ts';
import { createGridFeeds, createRecordedGridFeeds } from './gridFeeds.ts';
import { createLocalRuns } from './jobs/localRuns.ts';
import { createJobsApi } from './jobs/jobsApi.ts';
import { createSqliteJobRunStore } from './jobs/sqliteJobRunStore.ts';
import type { LocalRun } from '../data/LocalRun.type.ts';
import { parseEiaApiResponse, type EiaApiSnapshot } from '../core/energy/data/eiaApi.ts';
import { parseCaisoCsv, type CaisoSnapshot } from './caiso.ts';
import type { StoredSnapshot } from './SnapshotStore.type.ts';
import { snapshotRevision } from './snapshotRevision.ts';

type RecordedInputs = { asOf: string; eia: StoredSnapshot<EiaApiSnapshot>; caiso: StoredSnapshot<CaisoSnapshot> };
export function createApplicationPlugin(options: {
  apiKey: string; archiveDirectory: string; runDirectory: string; offline?: boolean;
  recorded?: RecordedInputs;
}): Plugin {
  async function install(server: ViteDevServer | PreviewServer) {
    await mkdir(resolve(options.runDirectory), { recursive: true });
    const stores = {
      eia: createSnapshotArchive<EiaApiSnapshot>(options.archiveDirectory, 'eia'),
      caiso: createSnapshotArchive<CaisoSnapshot>(options.archiveDirectory, 'caiso'),
    };
    if (options.recorded) {
      // Exercise the real provider parsers on sanitized captured source evidence.
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
    const jobs = createLocalRuns({ store: runStore, snapshots: stores, feeds, recordedAsOf: options.recorded?.asOf });
    server.middlewares.use(createGridApi(options.apiKey, stores, { feeds, offline: options.offline && !options.recorded }));
    server.middlewares.use(createJobsApi(jobs));
    server.httpServer?.once('close', () => { void jobs.close().finally(() => runStore.close()); });
  }
  return { name: 'public-grid-and-local-execution', configureServer: install, configurePreviewServer: install };
}
