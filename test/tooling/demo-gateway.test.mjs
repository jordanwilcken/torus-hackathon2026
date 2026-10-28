import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createDemoGateway } from '../../scripts/deploy/demo-gateway.mjs';

const publicOrigin = 'https://judges.example.test';
const revision = 'a'.repeat(64);
const runId = '12345678-1234-1234-1234-123456789abc';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
async function withDemo(options, exercise) {
  const received = [];
  let upstream;
  const backend = http.createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    received.push({ method: request.method, path: request.url, headers: request.headers, body });
    if (options.backend) { await options.backend(request, response, body); return; }
    if (request.method === 'POST' && request.headers.origin !== upstream) {
      response.writeHead(403); response.end('wrong upstream origin'); return;
    }
    response.writeHead(request.method === 'POST' ? 201 : 200, {
      'content-type': 'application/json', 'x-output-sha256': revision,
      'set-cookie': 'must-not-escape=1', 'access-control-allow-origin': '*',
    });
    response.end(JSON.stringify({ path: request.url, body }));
  });
  upstream = await listen(backend);
  const gateway = createDemoGateway({ publicOrigin, upstream, limits: options.limits, now: options.now, deploymentStatus: options.deploymentStatus });
  const address = await listen(gateway);
  const visit = (path, settings = {}) => request(address, path, settings);
  try { await exercise({ visit, received, upstream, address }); }
  finally { await close(gateway); await close(backend); }
}
function request(address, path, { method = 'GET', headers = {}, body = '', incomplete = false } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(address);
    const outgoing = http.request({ hostname: target.hostname, port: target.port, path, method,
      headers: { host: new URL(publicOrigin).host, ...(method === 'POST' ? { origin: publicOrigin, 'content-type': 'application/json' } : {}), ...headers } }, incoming => {
      let text = '';
      incoming.on('data', part => { text += part; });
      incoming.on('end', () => { outgoing.destroy(); resolve({ status: incoming.statusCode, headers: incoming.headers, text }); });
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(1500, () => outgoing.destroy(new Error('HTTP test request exceeded its deadline')));
    if (incomplete) outgoing.write(body);
    else outgoing.end(body);
  });
}
const write = (body = '{"hello":"judges"}') => ({ method: 'POST', body });

test('a judge saves a snapshot through HTTPS; backend receives only normalized local identity and returns exact evidence', async () => {
  await withDemo({}, async ({ visit, received, upstream }) => {
    const result = await visit('/api/fleet/captures', { ...write(), headers: {
      Authorization: 'Bearer do-not-forward', Cookie: 'private=do-not-forward',
      'x-forwarded-for': '203.0.113.10', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
      'cf-access-jwt-assertion': 'do-not-forward', 'x-arbitrary-header': 'do-not-forward',
    } });
    assert.equal(result.status, 201);
    assert.deepEqual(JSON.parse(result.text), { path: '/api/fleet/captures', body: '{"hello":"judges"}' });
    assert.equal(received[0].headers.host, new URL(upstream).host);
    assert.equal(received[0].headers.origin, upstream);
    for (const name of ['authorization', 'cookie', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'cf-access-jwt-assertion', 'x-arbitrary-header']) {
      assert.equal(received[0].headers[name], undefined, name);
    }
    assert.equal(result.headers['x-output-sha256'], revision);
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  });
});

test('judges can retrieve built assets, live inputs, a saved capture and CPU output with identifiers preserved', async () => {
  await withDemo({}, async ({ visit, received }) => {
    const paths = ['/?capture=' + revision + '&run=' + runId, '/index.html', '/assets/index-demo.js',
      '/api/weather/sites', '/api/grid/eia?revision=' + revision, '/api/grid/caiso',
      '/api/weather/revisions', '/api/weather/replay?at=2026-10-28T16:00:00Z',
      '/api/weather/replay?at=2026-10-28T16%3A00%3A00.000Z&revision=' + revision + '&selection=' + revision,
      '/api/weather/compare?earlier=' + revision + '&later=' + 'b'.repeat(64) + '&site=salt-lake_1',
      '/api/fleet/captures?revision=' + revision, '/api/jobs/context', '/api/jobs/runs/' + runId + '/output'];
    for (const path of paths) {
      assert.equal((await visit(path)).status, 200, path);
    }
    assert.deepEqual(received.map(value => value.path), paths);
    assert.equal((await visit('/assets/index-demo.css', { method: 'HEAD' })).status, 200);
    assert.equal((await visit('/api/jobs/runs', write())).status, 201);
  });
});

test('weather history accepts only bounded identifiers and one explicit UTC decision time', async () => {
  await withDemo({}, async ({ visit, received }) => {
    const comparison = '/api/weather/compare?earlier=' + revision + '&later=' + 'b'.repeat(64);
    const replay = '/api/weather/replay?at=2026-10-28T16:00:00Z';
    const invalid = [
      '/api/weather/revisions?revision=' + revision, '/api/weather/replay',
      '/api/weather/replay?at=2026-10-28', '/api/weather/replay?at=2026-02-30T16:00:00Z',
      '/api/weather/replay?at=2026-10-28T16:00:00%2B00:00',
      replay + '&at=2026-10-28T17:00:00Z', replay + '&revision=invalid',
      replay + '&selection=' + revision + '&selection=' + revision,
      replay + '&revision=' + revision + '&revision=' + revision,
      replay + '&url=https://evil.example', comparison,
      comparison + '&site=../private', comparison + '&site=' + 'a'.repeat(65),
      comparison + '&site=A&site=B', comparison + '&site=A&earlier=' + revision,
      comparison + '&site=A&later=' + revision, comparison + '&site=A&url=https://evil.example',
      '/api/weather/compare?earlier=invalid&later=' + revision + '&site=A',
    ];
    for (const path of invalid) assert.equal((await visit(path)).status, 404, path);
    assert.equal((await visit('/api/weather/revisions', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await visit(replay, { method: 'HEAD' })).status, 405);
    assert.equal(received.length, 0);
  });
});

test('wrong host and missing or foreign write origin never reach the backend', async () => {
  await withDemo({}, async ({ visit, received }) => {
    assert.equal((await visit('/', { headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await visit('/api/jobs/runs', { ...write(), headers: { origin: '' } })).status, 403);
    assert.equal((await visit('/api/fleet/captures', { ...write(), headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal(received.length, 0);
  });
});

test('unknown routes, traversal, executable source and unsupported methods are blocked before forwarding', async () => {
  await withDemo({}, async ({ visit, received }) => {
    for (const path of ['/src/main.tsx', '/@fs/C:/private', '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/index-demo.js.map', '/api/jobs/delete-all', '/api/grid/eia?url=https://evil.example']) {
      assert.equal((await visit(path)).status, 404, path);
    }
    assert.equal((await visit('/', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await visit('/api/jobs/runs', { method: 'DELETE' })).status, 405);
    assert.equal(received.length, 0);
  });
});

test('oversized bodies and non-JSON writes are rejected before the backend receives data', async () => {
  await withDemo({ limits: { jobBodyBytes: 12, captureBodyBytes: 20 } }, async ({ visit, received }) => {
    assert.equal((await visit('/api/jobs/runs', write('x'.repeat(13)))).status, 413);
    assert.equal((await visit('/api/fleet/captures', write('x'.repeat(21)))).status, 413);
    assert.equal((await visit('/api/jobs/runs', { ...write('{}'), headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal(received.length, 0);
  });
});

test('global write rate returns a useful retry response and refills after its time window', async () => {
  let now = 10_000;
  await withDemo({ limits: { postsPerMinute: 2 }, now: () => now }, async ({ visit, received }) => {
    assert.equal((await visit('/api/jobs/runs', write('{}'))).status, 201);
    assert.equal((await visit('/api/fleet/captures', write('{}'))).status, 201);
    const rejected = await visit('/api/jobs/runs', write('{}'));
    assert.equal(rejected.status, 429);
    assert.match(JSON.parse(rejected.text).error, /busy|limit/i);
    assert.ok(Number(rejected.headers['retry-after']) > 0);
    assert.equal(received.length, 2);
    now += 60_001;
    assert.equal((await visit('/api/jobs/runs', write('{}'))).status, 201);
  });
});

test('lifetime job and capture budgets remain exhausted after rate windows reset while reads stay available', async () => {
  let now = 1;
  await withDemo({ limits: { jobs: 1, captures: 1 }, now: () => now }, async ({ visit, received }) => {
    assert.equal((await visit('/api/jobs/runs', write('{}'))).status, 201);
    assert.equal((await visit('/api/fleet/captures', write('{}'))).status, 201);
    now += 120_000;
    assert.equal((await visit('/api/jobs/runs', write('{}'))).status, 429);
    assert.equal((await visit('/api/fleet/captures', write('{}'))).status, 429);
    assert.equal((await visit('/api/jobs/context')).status, 200);
    assert.equal(received.length, 3);
  });
});

test('capture byte budget includes every accepted write and prevents additional persistent data', async () => {
  await withDemo({ limits: { captureBytes: 6 } }, async ({ visit, received }) => {
    assert.equal((await visit('/api/fleet/captures', write('{}'))).status, 201);
    assert.equal((await visit('/api/fleet/captures', write('[1]'))).status, 201);
    assert.equal((await visit('/api/fleet/captures', write('{}'))).status, 429);
    assert.equal(received.length, 2);
  });
});

test('concurrent request limit rejects extra work while an upstream response is still pending', async () => {
  let announce, release;
  const arrived = new Promise(resolve => { announce = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  await withDemo({ limits: { concurrent: 1 }, backend: async (_request, response) => {
    announce(); await held; response.end('ready');
  } }, async ({ visit, received }) => {
    const first = visit('/api/jobs/context');
    await arrived;
    try {
      assert.equal((await visit('/api/grid/eia')).status, 429);
      assert.equal(received.length, 1);
    } finally { release(); }
    assert.equal((await first).text, 'ready');
  });
});

test('a stalled upload times out without reaching the backend', async () => {
  await withDemo({ limits: { readTimeoutMs: 50 } }, async ({ visit, received }) => {
    const result = await visit('/api/jobs/runs', { ...write('{'), incomplete: true });
    assert.equal(result.status, 408);
    assert.equal(received.length, 0);
  });
});

test('only an exact HTTPS public origin and an HTTP loopback upstream can be configured', () => {
  for (const bad of ['http://judges.example.test', 'https://judges.example.test/path', 'https://user:password@judges.example.test', 'https://judges.example.test/']) {
    assert.throws(() => createDemoGateway({ publicOrigin: bad }));
  }
  for (const upstream of ['https://127.0.0.1:5194', 'http://example.com', 'http://127.0.0.1:5194/path', 'http://user:password@127.0.0.1']) {
    assert.throws(() => createDemoGateway({ publicOrigin, upstream }));
  }
});

test('public deploy status exposes the exact deployed commit without private local paths, errors or tokens', async () => {
  await withDemo({ deploymentStatus: async () => ({
    activeCommit: 'a'.repeat(40), status: 'watching', lastAttemptedCommit: 'b'.repeat(40),
    deployedAt: '2026-10-28T19:00:00.000Z', updateFailed: true,
    releaseDirectory: 'C:/private/home', pid: 1234, lastFailure: 'secret-value',
  }) }, async ({ visit, received }) => {
    const result = await visit('/__demo/status');
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.text), { activeCommit: 'a'.repeat(40), status: 'watching',
      lastAttemptedCommit: 'b'.repeat(40), deployedAt: '2026-10-28T19:00:00.000Z', updateFailed: true });
    assert.equal(received.length, 0);
    assert.equal((await visit('/__demo/status', { headers: { Host: 'another.example' } })).status, 403);
  });
});
test('unavailable or malformed status does not expose its underlying error or unsafe public field values', async () => {
  await withDemo({ deploymentStatus: async () => { throw new Error('C:/private/secret-token'); } }, async ({ visit }) => {
    const result = await visit('/__demo/status');
    assert.equal(result.status, 503);
    assert.doesNotMatch(result.text, /private|secret-token/);
  });
  await withDemo({ deploymentStatus: async () => ({ activeCommit: 'private-value', status: 'C:/private/path',
    deployedAt: 'private-value', lastAttemptedCommit: 'private-value', updateFailed: 'private-value' }) }, async ({ visit }) => {
    const result = await visit('/__demo/status');
    assert.equal(result.status, 503);
    assert.doesNotMatch(result.text, /private-value|private\/path/);
  });
});
test('a chunked body exceeding its limit is rejected without partial upstream delivery', async () => {
  await withDemo({ limits: { jobBodyBytes: 10 } }, async ({ visit, received }) => {
    const result = await visit('/api/jobs/runs', { ...write('x'.repeat(11)), headers: { 'transfer-encoding': 'chunked' } });
    assert.equal(result.status, 413);
    assert.equal(received.length, 0);
  });
});
test('an upstream timeout returns a bounded error and releases the request slot', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await withDemo({ limits: { concurrent: 1, upstreamTimeoutMs: 50 }, backend: async (_request, response) => {
    await hold; response.end('available');
  } }, async ({ visit }) => {
    try { assert.equal((await visit('/api/jobs/context')).status, 504); }
    finally { release(); }
    assert.equal((await visit('/api/jobs/context')).status, 200);
  });
});

test('deployment handoff blocks new writes while allowing existing evidence to be read', async () => {
  const status = { activeCommit: 'a'.repeat(40), status: 'waiting-for-worker', lastAttemptedCommit: 'b'.repeat(40),
    deployedAt: '2026-10-28T19:00:00.000Z', updateFailed: false };
  await withDemo({ deploymentStatus: async () => status }, async ({ visit, received }) => {
    assert.equal((await visit('/api/jobs/runs', write('{}'))).status, 503);
    status.status = 'switching';
    assert.equal((await visit('/api/fleet/captures', write('{}'))).status, 503);
    assert.equal((await visit('/api/jobs/context')).status, 200);
    assert.equal(received.length, 1);
    status.status = 'watching';
    assert.equal((await visit('/api/jobs/runs', write('{}'))).status, 201);
  });
});
test('configured but unreadable deployment status fails closed for new writes', async () => {
  await withDemo({ deploymentStatus: async () => { throw new Error('private status path'); } }, async ({ visit, received }) => {
    const result = await visit('/api/jobs/runs', write('{}'));
    assert.equal(result.status, 503);
    assert.doesNotMatch(result.text, /private status path/);
    assert.equal(received.length, 0);
  });
});
