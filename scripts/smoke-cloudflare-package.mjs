import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { unstable_dev } from 'wrangler';

// Starts the exact no-bundle production artifact, never the historical test entry.
const directory = resolve(process.argv[2] ?? '.cache/cloudflare/release');
const config = JSON.parse(await readFile(join(directory, 'wrangler.json'), 'utf8'));
assert.equal(config.no_bundle, true);
const temporaryRoot = await realpath(tmpdir());
const persistTo = await mkdtemp(join(temporaryRoot, 'sunchaser-artifact-smoke-'));
let worker;
try {
  worker = await unstable_dev(resolve(directory, config.main), {
    config: join(directory, 'wrangler.json'), bundle: false, local: true,
    ip: '127.0.0.1', port: 0, persist: true, persistTo, logLevel: 'error',
    vars: { EIA_API_KEY: 'synthetic-no-upstream-smoke', DEMO_USERNAME: 'judge', DEMO_PASSWORD: 'synthetic-hosting-test-password' },
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, showInteractiveDevSession: false, enableContainers: false },
  });
  const request = (path, options) => fetch('http://127.0.0.1:' + worker.port + path, options);
  const headers = { Authorization: 'Basic ' + Buffer.from('judge:synthetic-hosting-test-password').toString('base64') };
  assert.equal((await request('/healthz')).status, 200);
  assert.equal((await request('/')).status, 401);
  assert.equal((await request('/api/jobs/context')).status, 401);
  const page = await request('/', { headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.equal(html, await readFile(join(directory, 'dist/index.html'), 'utf8'));
  const asset = html.match(/src="([^\"]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.equal((await request(asset)).status, 401);
  assert.equal((await request(asset, { headers })).status, 200);
  // This enters the real Durable Object and initializes actual SQLite, without an upstream request.
  const unknown = await request('/api/unknown', { headers });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'API route not found.' });
  console.log('Exact production artifact passed workerd startup, assets, authentication and SQLite API routing. No upstream request or cloud deployment performed.');
} finally {
  await worker?.stop();
  if (dirname(persistTo) !== temporaryRoot || !basename(persistTo).startsWith('sunchaser-artifact-smoke-')) throw new Error('Refusing to remove an unowned artifact test directory.');
  await rm(persistTo, { recursive: true, force: true });
}
