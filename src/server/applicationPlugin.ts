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
import type { SiteWeatherSnapshot, SiteWeatherSelection } from '../data/SiteWeather.type.ts';
import { modeledSites } from '../data/modeledSites.ts';
import { createSiteWeatherFeed, parseSiteWeatherResponse } from './siteWeather.ts';
import { createSiteWeatherApi } from './siteWeatherApi.ts';
import { createFleetCaptureApi } from './fleetCaptureApi.ts';
import type { FrozenFleetSnapshot } from '../data/FrozenFleet.type.ts';

type RecordedInputs = { asOf: string; eia: StoredSnapshot<EiaApiSnapshot>; caiso: StoredSnapshot<CaisoSnapshot> };
export function createApplicationPlugin(options: {
  apiKey: string; archiveDirectory: string; runDirectory: string; offline?: boolean;
  recorded?: RecordedInputs; recordedWeather?: StoredSnapshot<SiteWeatherSnapshot>;
  weatherSelection?: SiteWeatherSelection;
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
    const weatherStore = createSnapshotArchive<SiteWeatherSnapshot>(options.archiveDirectory, 'open-meteo');
    if (options.recordedWeather) {
      const supplied = options.recordedWeather.evidence.body as { response: unknown; retrievedAt: string };
      const weather = parseSiteWeatherResponse(supplied.response, supplied.retrievedAt,
        options.recordedWeather.snapshot.metadata ? { selection:options.recordedWeather.snapshot.metadata.selection } : {});
      if (snapshotRevision(weather) !== options.recordedWeather.revision) throw new Error('Captured weather evidence does not reproduce its revision');
      await weatherStore.save(weather, options.recordedWeather.evidence);
    }
    const weather = createSiteWeatherFeed(weatherStore, {
      offline: options.offline || Boolean(options.recorded), recorded: Boolean(options.recordedWeather),
      ...(options.recordedWeather?.snapshot.metadata ? { selection:options.recordedWeather.snapshot.metadata.selection } : {}),
      ...(!options.recordedWeather && !options.offline && !options.recorded ? { selection:options.weatherSelection ?? {
        sites:modeledSites.map(({id,latitude,longitude}) => ({id,latitude,longitude})), forecastDays:7,
        variables:['shortwave_radiation','shortwave_radiation_instant','temperature_2m','cloud_cover'],
      } as SiteWeatherSelection } : {}),
    });
    const runStore = createSqliteJobRunStore<LocalRun>(join(options.runDirectory, 'runs.sqlite'));
    const jobs = createLocalRuns({ store: runStore, snapshots: stores, feeds, recordedAsOf: options.recorded?.asOf });
    server.middlewares.use(createGridApi(options.apiKey, stores, { feeds, offline: options.offline && !options.recorded }));
    server.middlewares.use(createJobsApi(jobs));
    server.middlewares.use(createSiteWeatherApi(weather, weatherStore));
    server.middlewares.use(createFleetCaptureApi(createSnapshotArchive<FrozenFleetSnapshot>(options.archiveDirectory, 'fleet-captures')));
    server.httpServer?.once('close', () => { void jobs.close().finally(() => runStore.close()); });
  }
  return { name: 'public-grid-and-local-execution', configureServer: install, configurePreviewServer: install };
}
