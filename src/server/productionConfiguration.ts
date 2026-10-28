import { resolve } from 'node:path';
import { validatePublicOrigin, type ProductionServerOptions } from './productionServer.ts';

/** Runtime secrets are read by Node, never loaded through Vite's browser environment. */
export function productionConfiguration(environment: NodeJS.ProcessEnv): ProductionServerOptions {
  const port = Number(environment.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  if (!environment.EIA_API_KEY?.trim()) throw new Error('EIA_API_KEY is required for the live deployment.');
  return {
    host: environment.HOST || '127.0.0.1', port,
    publicOrigin: validatePublicOrigin(environment.PUBLIC_ORIGIN ?? ''),
    username: environment.DEMO_USERNAME ?? '', password: environment.DEMO_PASSWORD ?? '',
    distDirectory: resolve(environment.DIST_DIRECTORY || 'dist'),
    application: { apiKey: environment.EIA_API_KEY,
      archiveDirectory: resolve(environment.GRID_SNAPSHOT_DIR || '.cache/grid'),
      runDirectory: resolve(environment.JOB_RUN_DIRECTORY || '.cache/jobs') },
  };
}
