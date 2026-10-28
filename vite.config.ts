import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { createApplicationPlugin } from './src/server/applicationPlugin.ts';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'EIA_');
  return { plugins: [react(), createApplicationPlugin({
    apiKey: process.env.EIA_API_KEY ?? environment.EIA_API_KEY ?? '',
    archiveDirectory: process.env.GRID_SNAPSHOT_DIR ?? '.cache/grid',
    runDirectory: process.env.JOB_RUN_DIRECTORY ?? '.cache/jobs',
    offline: process.env.GRID_FEEDS_OFFLINE === '1',
  })] };
});
