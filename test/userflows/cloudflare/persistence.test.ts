import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };
import type { LocalRun } from '../../../src/data/LocalRun.type';
import { cloudflareRuntime } from './runtime.ts';

test('Cloudflare SQL keeps the exact receipt and output across a real runtime restart without rerunning work', async () => {
  test.setTimeout(120_000);
  const runtime = await cloudflareRuntime(4179);
  const headers = { Authorization: 'Basic ' + Buffer.from('judge:synthetic-hosting-test-password').toString('base64'), 'Content-Type': 'application/json', Origin: runtime.url };
  const requestId = randomUUID();
  const input = { requestId, workload: { kind: 'integer-sum', values: [7, 8] },
    inputRevisions: { eia: manifest.feeds.eia.revision, caiso: manifest.feeds.caiso.revision },
    policy: { maximumDemandMW: 20000, maximumWholesaleUsdPerMWh: 1000, maximumAgeMinutes: { eia: 180, caiso: 20 } },
    model: { computeKWh: 10, roundTripEfficiency: 0.8 } };
  const read = async () => {
    const response = await fetch(runtime.url + '/api/jobs/runs/' + requestId, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    return await response.json() as LocalRun;
  };
  try {
    // Public health exposes no data; neither API nor assets bypass authentication.
    expect((await fetch(runtime.url + '/healthz')).status).toBe(200);
    expect((await fetch(runtime.url + '/')).status).toBe(401);
    expect((await fetch(runtime.url + '/api/jobs/context')).status).toBe(401);
    const page = await fetch(runtime.url + '/', { headers });
    expect(page.status).toBe(200);
    const html = await page.text();
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    expect((await fetch(new URL(asset!, runtime.url))).status).toBe(401);
    expect((await fetch(new URL(asset!, runtime.url), { headers })).status).toBe(200);
    const denied = await fetch(runtime.url + '/api/jobs/runs', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify(input) });
    expect(denied.status).toBe(403);
    const absent = await fetch(runtime.url + '/api/jobs/runs/' + requestId, { headers });
    expect(absent.status).toBe(404);
    const submitted = await fetch(runtime.url + '/api/jobs/runs', { method: 'POST', headers, body: JSON.stringify(input) });
    expect(submitted.status).toBe(202);
    await expect.poll(async () => (await read()).status).toBe('done');
    const original = await read();
    expect(original.execution.backend).toBe('cloudflare-durable-object');
    expect(original.execution.pid).toBeNull();
    expect(original.execution.exitCode).toBeNull();
    expect(original.execution.simulated).toBe(false);
    const outputResponse = await fetch(runtime.url + '/api/jobs/runs/' + requestId + '/output', { headers });
    const output = await outputResponse.text();
    expect(JSON.parse(output)).toEqual({ requestId, sum: 15 });
    expect(outputResponse.headers.get('X-Output-SHA256')).toBe(createHash('sha256').update(output).digest('hex'));
    expect(original.execution.output?.text).toBe(output);

    await runtime.restart();
    // First access after process restart is a GET, not a new submission.
    expect(await read()).toEqual(original);
    const restored = await fetch(runtime.url + '/api/jobs/runs/' + requestId + '/output', { headers });
    expect(await restored.text()).toBe(output);
    expect(restored.headers.get('X-Output-SHA256')).toBe(original.execution.output?.id);
    const duplicate = await fetch(runtime.url + '/api/jobs/runs', { method: 'POST', headers, body: JSON.stringify(input) });
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual(original);
    expect(await read()).toEqual(original);
    const archive = await fetch(runtime.url + '/api/grid/eia?revision=' + manifest.feeds.eia.revision, { headers });
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({ archived: true, revision: manifest.feeds.eia.revision });
  } finally { await runtime.dispose(); }
});
