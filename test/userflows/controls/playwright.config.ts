import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '*.test.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  outputDir: '../../../test-results/playback-controls',
  use: {
    baseURL: 'http://127.0.0.1:4186',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `"${process.execPath}" "./node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 4186 --strictPort`,
    cwd: repository,
    url: 'http://127.0.0.1:4186',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
