import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cloudflareRuntime } from './runtime.ts';
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };

// A separate Node process captures workerd's own diagnostics, not a mocked Request implementation.
const runtime = await cloudflareRuntime(4181);
const headers = { Authorization: 'Basic ' + Buffer.from('judge:synthetic-hosting-test-password').toString('base64'),
  'Content-Type': 'application/json', Origin: runtime.url };
const input = { requestId: randomUUID(), workload: { kind: 'integer-sum', values: [7, 8] },
  inputRevisions: { eia: manifest.feeds.eia.revision, caiso: manifest.feeds.caiso.revision },
  policy: { maximumDemandMW: 20000, maximumWholesaleUsdPerMWh: 1000, maximumAgeMinutes: { eia: 180, caiso: 20 } },
  model: { computeKWh: 10, roundTripEfficiency: .8 } };
try {
  const cases: Array<{ name: string; status: number; headers: Record<string, string>; body: BodyInit }> = [
    { name: 'unauthenticated', status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    { name: 'cross-origin', status: 403, headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify(input) },
    { name: 'oversized', status: 413, headers, body: ' '.repeat(256001) },
    { name: 'chunked-oversized', status: 413, headers, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(256001)); controller.close(); } }) },
    { name: 'unauthenticated-oversized', status: 401, headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(256001) },
    { name: 'malformed-json', status: 400, headers, body: '{' },
  ];
  for (const example of cases) {
    const response = await fetch(runtime.url + '/api/jobs/runs', { method: 'POST', headers: example.headers, body: example.body, duplex: 'half' } as RequestInit & { duplex: 'half' });
    assert.equal(response.status, example.status, example.name);
    await response.text();
  }
  const rejectedAssetUpload = await fetch(runtime.url + '/', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(rejectedAssetUpload.status, 405);
  await rejectedAssetUpload.text();
  const absent = await fetch(runtime.url + '/api/jobs/runs/' + input.requestId, { headers });
  assert.equal(absent.status, 404);
  await absent.text();
  console.info('WORKERD_STREAM_CASES=7');
} finally { await runtime.dispose(); }
