import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/userflows',
  globalSetup: './test/userflows/cloudflare/start.ts',
  fullyParallel: false, forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: '.reports/cloudflare-report', open: 'never' }], ['json', { outputFile: '.reports/cloudflare.json' }]],
  outputDir: '.reports/cloudflare-results',
  use: { baseURL: 'http://127.0.0.1:4178', httpCredentials: { username: 'judge', password: 'synthetic-hosting-test-password' }, headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'cloudflare-desktop', testMatch: ['**/liveExecution.test.ts', '**/cloudflare/persistence.test.ts', '**/cloudflare/http-stream.test.ts'], use: { ...devices['Desktop Chrome'] } },
    { name: 'cloudflare-mobile', testMatch: '**/liveExecution.test.ts', use: { ...devices['Pixel 7'] } },
  ],
});
