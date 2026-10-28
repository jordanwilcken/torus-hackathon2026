import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { createGridApi } from './src/server/gridApi.ts';
import { createSnapshotArchive } from './src/server/snapshotArchive.ts';
import type { EiaApiSnapshot } from './src/core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from './src/server/caiso.ts';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'EIA_');
  const apiKey = process.env.EIA_API_KEY ?? environment.EIA_API_KEY ?? '';
  // Choose storage here. Collectors and HTTP consumers depend only on SnapshotStore.
  const directory = process.env.GRID_SNAPSHOT_DIR ?? '.cache/grid';
  const stores = {
    eia: createSnapshotArchive<EiaApiSnapshot>(directory, 'eia'),
    caiso: createSnapshotArchive<CaisoSnapshot>(directory, 'caiso'),
  };
  const api = () => createGridApi(apiKey, stores, { offline: process.env.GRID_FEEDS_OFFLINE === '1' });
  return { plugins: [react(), {
    name: 'public-grid-feeds',
    configureServer(server) { server.middlewares.use(api()); },
    configurePreviewServer(server) { server.middlewares.use(api()); },
  }] };
});
