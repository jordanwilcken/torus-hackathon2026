import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/userflows/execution',
  testMatch: 'liveExecution.test.ts',
  globalSetup: './test/userflows/hosting/start.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '.reports/hosting-report', open: 'never' }],
    ['json', { outputFile: '.reports/hosting.json' }],
  ],
  outputDir: '.reports/hosting-results',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    httpCredentials: { username: 'judge', password: 'synthetic-hosting-test-password' },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'hosting-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'hosting-mobile', use: { ...devices['Pixel 7'] } },
  ],
});
