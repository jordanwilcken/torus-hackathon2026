import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
    testDir: '.', testMatch: '*.test.ts', fullyParallel: true, retries: 0,
    forbidOnly: Boolean(process.env.CI), reporter: [['list']],
    outputDir: '../../../test-results/paired-replay',
    use: { baseURL: 'http://127.0.0.1:4188', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `"${process.execPath}" "./node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 4188 --strictPort`,
        cwd: repository, url: 'http://127.0.0.1:4188', reuseExistingServer: false, timeout: 30_000,
    },
});
