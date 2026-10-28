import { afterEach, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startProductionServer, type ProductionServerOptions } from '../../../src/server/productionServer.ts';
import type { LocalRun, LocalRunRequest } from '../../../src/data/LocalRun.type.ts';
import eia from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import caiso from '../../fixtures/public-grid/caiso.json' with { type: 'json' };
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };
import type { EiaApiSnapshot } from '../../../src/core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from '../../../src/server/caiso.ts';
import type { StoredSnapshot } from '../../../src/server/SnapshotStore.type.ts';

let server: Awaited<ReturnType<typeof startProductionServer>> | undefined;
let directory: string | undefined;
let options: ProductionServerOptions;
const password = 'a-strong-demo-test-password';
const authorization = `Basic ${Buffer.from(`judge:${password}`).toString('base64')}`;
const publicOrigin = 'https://demo.example.com';
let base: string;
afterEach(async () => {
  await server?.close(); server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function openDemo() {
  directory = await mkdtemp(join(tmpdir(), 'sunchaser-hosting-'));
  await mkdir(join(directory, 'dist/assets'), { recursive: true });
  await writeFile(join(directory, 'dist/index.html'), '<html><body>Sunchaser demo</body></html>');
  await writeFile(join(directory, 'dist/assets/app.js'), 'console.info("demo")');
  options = {
    port: 0, distDirectory: join(directory, 'dist'), publicOrigin,
    username: 'judge', password,
    application: { apiKey: '', archiveDirectory: join(directory, 'grid'), runDirectory: join(directory, 'jobs'),
      recorded: { asOf: manifest.asOf, eia: eia as StoredSnapshot<EiaApiSnapshot>, caiso: caiso as StoredSnapshot<CaisoSnapshot> } },
  };
  server = await startProductionServer(options);
  base = `http://127.0.0.1:${server.port}`;
}

function request(): LocalRunRequest {
  return { requestId: randomUUID(), workload: { kind: 'integer-sum', values: [1, 2, 3, 4] },
    inputRevisions: { eia: manifest.feeds.eia.revision, caiso: manifest.feeds.caiso.revision },
    policy: { maximumDemandMW: 20000, maximumWholesaleUsdPerMWh: 100, maximumAgeMinutes: { eia: 240, caiso: 30 } },
    model: { computeKWh: 1, roundTripEfficiency: .9 } };
}
const read = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers: { authorization, ...headers } });
const post = (value: LocalRunRequest, origin = publicOrigin, extraHeaders = {}) => fetch(base + '/api/jobs/runs', {
  method: 'POST', headers: { authorization, Origin: origin, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(value),
});
async function completed(id: string): Promise<LocalRun> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await read(`/api/jobs/runs/${id}`);
    expect(response.status).toBe(200);
    const run = await response.json() as LocalRun;
    if (!['queued', 'running'].includes(run.status)) return run;
    await delay(20);
  }
  throw new Error('Actual production worker did not finish.');
}

test('judges must authenticate before seeing the hosted app or calling job APIs', async () => {
  await openDemo();
  expect((await fetch(base)).status).toBe(401);
  expect((await fetch(base + '/api/jobs/context')).status).toBe(401);
  expect((await fetch(base + '/api/jobs/runs', { method: 'POST' })).status).toBe(401);
  const rejected = await read('/', { authorization: `Basic ${Buffer.from('judge:incorrect').toString('base64')}` });
  expect(rejected.status).toBe(401);
  expect(rejected.headers.get('www-authenticate')).toContain('Basic');
  expect(await rejected.text()).not.toContain(password);
});

test('authenticated judges receive built assets and can refresh a receipt URL', async () => {
  await openDemo();
  const document = await read('/?run=00000000-0000-0000-0000-000000000001');
  expect(document.status).toBe(200);
  expect(document.headers.get('content-type')).toContain('text/html');
  expect(await document.text()).toContain('Sunchaser demo');
  const navigation = await read('/runs/example', { accept: 'text/html' });
  expect(navigation.status).toBe(200);
  expect(await navigation.text()).toContain('Sunchaser demo');
  const asset = await read('/assets/app.js');
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toContain('javascript');
  expect(await asset.text()).toBe('console.info("demo")');
  const head = await fetch(base + '/', { method: 'HEAD', headers: { authorization } });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
});

test('health checks disclose only process readiness without authentication', async () => {
  await openDemo();
  const response = await fetch(base + '/healthz');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('missing API routes and missing assets remain errors instead of an HTML success', async () => {
  await openDemo();
  for (const path of ['/api/unknown', '/assets/missing.js', '/api']) {
    const response = await read(path, { accept: 'text/html' });
    expect(response.status, path).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).not.toContain('Sunchaser demo');
  }
});

test('source, dotfiles, encoded traversal and links outside the built directory are not served', async () => {
  await openDemo();
  await writeFile(join(directory!, 'secret.json'), '{"secret":"outside-dist"}');
  await writeFile(join(directory!, 'dist/.env.local'), 'EIA_API_KEY=not-public');
  await symlink(directory!, join(directory!, 'dist/escape'), 'junction');
  try {
    for (const path of ['/.env.local', '/src/server/start.ts', '/%2e%2e%2fsecret.json', '/escape/secret.json', '/assets/app.js.map']) {
      const response = await read(path, { accept: 'text/html' });
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain('outside-dist');
    }
  } finally {
    // Remove only the test-created junction; recursive cleanup must never follow it.
    await rm(join(directory!, 'dist/escape'));
  }
});

test('the configured HTTPS origin can submit through an HTTP reverse proxy and its receipt survives restart', async () => {
  await openDemo();
  const input = request();
  expect((await post(input)).status).toBe(202);
  const run = await completed(input.requestId);
  expect(run.status).toBe('done');
  expect(run.execution.pid).toBeGreaterThan(0);
  expect(run.execution.exitCode).toBe(0);
  expect(run.decision.inputs.find(input => input.feed === 'eia')?.value).toBe(5108);
  expect(run.decision.inputs.find(input => input.feed === 'caiso')?.value).toBe(33.4753);
  const output = await read(`/api/jobs/runs/${input.requestId}/output`);
  const text = await output.text();
  expect(JSON.parse(text)).toEqual({ requestId: input.requestId, sum: 10 });
  expect(output.headers.get('x-output-sha256')).toBe(createHash('sha256').update(text).digest('hex'));
  await server!.close();
  server = await startProductionServer(options);
  base = `http://127.0.0.1:${server.port}`;
  const recovered = await (await read(`/api/jobs/runs/${input.requestId}`)).json();
  expect(recovered).toEqual(run);
  expect(await (await read(`/api/jobs/runs/${input.requestId}/output`)).text()).toBe(text);
  const replay = await (await read(`/api/grid/eia?revision=${manifest.feeds.eia.revision}`)).json();
  expect(replay.revision).toBe(manifest.feeds.eia.revision);
  expect(replay.snapshot.retrievedAt).toBe(eia.snapshot.retrievedAt);
  // Repeating the same submission returns the original process receipt; no new process is launched.
  expect(await (await post(input)).json()).toEqual(run);
});

test('another origin cannot start work even with credentials and forged forwarding headers', async () => {
  await openDemo();
  const input = request();
  const response = await post(input, 'https://attacker.example.com', {
    'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'attacker.example.com',
  });
  expect(response.status).toBe(403);
  expect((await read(`/api/jobs/runs/${input.requestId}`)).status).toBe(404);
});

test('production refuses missing or short demo credentials before opening a listener', async () => {
  await openDemo();
  await server!.close(); server = undefined;
  await expect(startProductionServer({ ...options, password: '' })).rejects.toThrow('DEMO_PASSWORD');
  await expect(startProductionServer({ ...options, password: 'short' })).rejects.toThrow('DEMO_PASSWORD');
  await expect(startProductionServer({ ...options, username: '' })).rejects.toThrow('DEMO_USERNAME');
});
