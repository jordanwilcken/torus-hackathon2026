import { expect, test, vi } from 'vitest';
import worker, { type WorkerEnvironment } from '../../../src/cloudflare/worker.ts';
import { handleDemoApi, type DemoApi } from '../../../src/cloudflare/http.ts';
import type { LocalRun, LocalRunRequest } from '../../../src/data/LocalRun.type.ts';
import type { LocalRuns } from '../../../src/server/jobs/localRuns.ts';
import type { GridFeeds, GridSnapshotStores } from '../../../src/server/gridFeeds.ts';
import eia from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };

const origin = 'https://sunchaser-demo.example.workers.dev';
const credentials = { DEMO_USERNAME: 'judge', DEMO_PASSWORD: 'synthetic-cloudflare-test-password', EIA_API_KEY: 'test-key-never-in-response' };
const authorization = `Basic ${Buffer.from(`${credentials.DEMO_USERNAME}:${credentials.DEMO_PASSWORD}`).toString('base64')}`;
const requestId = '00000000-0000-4000-8000-000000000001';
function input(): LocalRunRequest {
  return { requestId, workload: { kind: 'integer-sum', values: [1, 2, 3, 4] },
    inputRevisions: { eia: manifest.feeds.eia.revision, caiso: manifest.feeds.caiso.revision },
    policy: { maximumDemandMW: 20000, maximumWholesaleUsdPerMWh: 100, maximumAgeMinutes: { eia: 240, caiso: 30 } },
    model: { computeKWh: 1, roundTripEfficiency: .9 } };
}
function environment() {
  const assets = vi.fn(async () => new Response('<html>built UI</html>', { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=3600' } }));
  const api = vi.fn(async () => Response.json({ context: 'same durable demo' }));
  const idFromName = vi.fn((name: string) => ({ toString: () => name }));
  const env: WorkerEnvironment = { ...credentials, ASSETS: { fetch: assets }, DEMO: { idFromName, get: () => ({ fetch: api }) } };
  return { env, assets, api, idFromName };
}
function services() {
  const latest = vi.fn(async () => ({ status: 'ready', snapshot: eia.snapshot, revision: eia.revision, lastAttemptAt: null, nextRefreshAt: null }));
  const read = vi.fn(async (revision: string) => revision === eia.revision ? eia : null);
  const submit = vi.fn(async (value: LocalRunRequest) => ({ id: value.requestId }) as LocalRun);
  const idle = Promise.resolve();
  const waitUntil = vi.fn();
  const jobs = { context: async () => ({ mode: 'live' }), submit, read: async () => null, waitForIdle: () => idle } as unknown as LocalRuns;
  const api: DemoApi = { jobs, waitUntil, feeds: { eia: { read: latest } } as unknown as GridFeeds,
    stores: { eia: { read } } as unknown as GridSnapshotStores };
  return { api, latest, read, submit, idle, waitUntil };
}
const post = (body: string, headers: Record<string, string> = {}) => new Request(origin + '/api/jobs/runs', {
  method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body,
});

test('Cloudflare requires demo authentication before serving assets or forwarding API calls', async () => {
  const { env, assets, api } = environment();
  for (const path of ['/', '/assets/app.js', '/api/jobs/context']) {
    const response = await worker.fetch(new Request(origin + path), env);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic');
  }
  expect(assets).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
});

test('authenticated assets stay private and API traffic uses the stable demo object', async () => {
  const { env, assets, api, idFromName } = environment();
  const document = await worker.fetch(new Request(origin + '/', { headers: { authorization } }), env);
  expect(await document.text()).toBe('<html>built UI</html>');
  expect(document.headers.get('cache-control')).toContain('private');
  expect(assets).toHaveBeenCalledOnce();
  const response = await worker.fetch(new Request(origin + '/api/jobs/context', { headers: { authorization } }), env);
  expect(await response.json()).toEqual({ context: 'same durable demo' });
  expect(api).toHaveBeenCalledOnce(); expect(idFromName).toHaveBeenCalledWith('demo');
});

test('public HTTP redirects to HTTPS before an authentication challenge', async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request(origin.replace('https:', 'http:') + '/?run=saved'), env);
  expect(response.status).toBe(308);
  expect(response.headers.get('location')).toBe(origin + '/?run=saved');
  expect(response.headers.has('www-authenticate')).toBe(false);
});

test('health exposes only readiness and missing configuration cannot serve a supposed live demo', async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request(origin + '/healthz'), env);
  expect(await response.json()).toEqual({ status: 'ok' });
  const missing = await worker.fetch(new Request(origin + '/', { headers: { authorization } }), { ...env, EIA_API_KEY: '' });
  expect(missing.status).toBe(503);
  expect(await missing.text()).not.toContain(credentials.DEMO_PASSWORD);
});

test('valid JSON work is handed to the existing runner and its lifetime is retained', async () => {
  const { api, submit, waitUntil, idle } = services();
  const response = await handleDemoApi(post(JSON.stringify(input())), api);
  expect(response.status).toBe(202);
  expect(submit).toHaveBeenCalledWith(input());
  expect(await response.json()).toEqual({ id: requestId });
  expect(waitUntil).toHaveBeenCalledWith(idle);
});

test('foreign origins and arbitrary workloads cannot reach execution', async () => {
  const { api, submit } = services();
  const foreign = await handleDemoApi(post(JSON.stringify(input()), { origin: 'https://attacker.example', 'x-forwarded-host': new URL(origin).host }), api);
  expect(foreign.status).toBe(403);
  const arbitrary = await handleDemoApi(post(JSON.stringify({ ...input(), workload: { kind: 'shell', command: 'anything' } })), api);
  expect(arbitrary.status).toBe(400);
  expect(submit).not.toHaveBeenCalled();
});

test('declared and actual oversized bodies are rejected before execution', async () => {
  const { api, submit } = services();
  expect((await handleDemoApi(post('{}', { 'content-length': '256001' }), api)).status).toBe(413);
  expect((await handleDemoApi(post(' '.repeat(256001)), api)).status).toBe(413);
  expect((await handleDemoApi(post('{}', { 'content-type': 'text/plain' }), api)).status).toBe(415);
  expect(submit).not.toHaveBeenCalled();
});

test('exact revision replay preserves the captured snapshot and never falls back to latest', async () => {
  const { api, latest } = services();
  const response = await handleDemoApi(new Request(`${origin}/api/grid/eia?revision=${eia.revision}`), api);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ archived: true, revision: eia.revision, snapshot: eia.snapshot });
  const missing = await handleDemoApi(new Request(`${origin}/api/grid/eia?revision=${'f'.repeat(64)}`), api);
  expect(missing.status).toBe(404); expect(latest).not.toHaveBeenCalled();
});

test('unknown API routes and failed storage reads remain JSON failures', async () => {
  const { api } = services();
  const missing = await handleDemoApi(new Request(origin + '/api/unknown'), api);
  expect(missing.status).toBe(404); expect(missing.headers.get('content-type')).toContain('application/json');
  api.jobs.read = async () => { throw new Error('private storage detail'); };
  const failed = await handleDemoApi(new Request(`${origin}/api/jobs/runs/${requestId}`), api);
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private storage detail');
});

test('a rejected cross-origin stream is cancelled before the Durable Object response returns', async () => {
  const { api, submit } = services();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request(origin + '/api/jobs/runs', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, body, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  expect((await handleDemoApi(request, api)).status).toBe(403);
  expect(cancelled).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});

test('an unauthenticated streaming upload is rejected before forwarding or reading its body', async () => {
  const { env, api } = environment();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request(origin + '/api/jobs/runs', { method: 'POST', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
  expect((await worker.fetch(request, env)).status).toBe(401);
  expect(request.bodyUsed).toBe(false);
  expect(api).not.toHaveBeenCalled();
});
