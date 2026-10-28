import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createApplicationPlugin } from '../../../src/server/applicationPlugin.ts';
import eia from '../../fixtures/public-grid/eia.json';
import caiso from '../../fixtures/public-grid/caiso.json';
import manifest from '../../fixtures/public-grid/manifest.json';
import type { EiaApiSnapshot } from '../../../src/core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from '../../../src/server/caiso.ts';
import type { StoredSnapshot } from '../../../src/server/SnapshotStore.type.ts';

export default defineConfig(async () => {
  // Restart tests supply their owned directory; browser servers otherwise start with fresh stores.
  const directory = process.env.LOCAL_RUN_TEST_DIRECTORY || await mkdtemp(join(tmpdir(), 'sunchaser-browser-runs-'));
  return { plugins: [react(), createApplicationPlugin({
    apiKey: '', archiveDirectory: join(directory, 'grid'), runDirectory: join(directory, 'jobs'),
    recorded: { asOf: manifest.asOf, eia: eia as StoredSnapshot<EiaApiSnapshot>, caiso: caiso as StoredSnapshot<CaisoSnapshot> },
  })] };
});
