import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { createGridApi } from './src/server/gridApi.ts';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'EIA_');
  const apiKey = process.env.EIA_API_KEY ?? environment.EIA_API_KEY ?? '';
  return { plugins: [react(), {
    name: 'public-grid-feeds',
    configureServer(server) { server.middlewares.use(createGridApi(apiKey, process.env.GRID_FEEDS_OFFLINE === '1')); },
    configurePreviewServer(server) { server.middlewares.use(createGridApi(apiKey, process.env.GRID_FEEDS_OFFLINE === '1')); },
  }] };
});
