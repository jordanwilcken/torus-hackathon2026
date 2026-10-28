import http from 'node:http';
import { resolve } from 'node:path';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const defaults = Object.freeze({
  concurrent: 16, readTimeoutMs: 15_000, upstreamTimeoutMs: 30_000,
  postsPerMinute: 20, jobs: 500, captures: 250, captureBytes: 256 * 1024 * 1024,
  jobBodyBytes: 256_000, captureBodyBytes: 5 * 1024 * 1024,
});
const revisionPattern = /^[a-f0-9]{64}$/;
const runPath = /^\/api\/jobs\/runs\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(\/output)?$/;
const responseHeaders = ['content-type', 'content-length', 'content-encoding', 'cache-control', 'etag', 'last-modified', 'content-disposition', 'x-output-sha256'];

function rejected(status, message) {
  return Object.assign(new Error(message), { status });
}
function configuration(publicOrigin, upstream, suppliedLimits) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw new Error('Supply an exact HTTPS public origin without a path or credentials.');
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('The upstream must be an HTTP loopback origin.');
  }
  const limits = { ...defaults, ...suppliedLimits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Object.hasOwn(defaults, name) || !Number.isSafeInteger(value) || value <= 0) throw new Error('Demo limits must be known positive integer values.');
  }
  return { origin, target, limits };
}
function validRevisionQuery(url, required = false) {
  const revisions = url.searchParams.getAll('revision');
  return revisions.length <= 1 && (!required || revisions.length === 1)
    && [...url.searchParams.keys()].every(name => name === 'revision')
    && (!revisions.length || revisionPattern.test(revisions[0]));
}
function routeFor(request) {
  const raw = request.url ?? '';
  const rawPath = raw.split('?')[0];
  if (raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//') || /[%\\]/.test(rawPath)) throw rejected(404, 'Demo route not found.');
  const url = new URL(raw, 'http://gateway');
  if (url.pathname !== rawPath || url.hash) throw rejected(404, 'Demo route not found.');
  const path = url.pathname;
  const method = request.method;
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw rejected(405, 'Use a supported demo request.');
  if (method === 'POST') {
    if (url.search) throw rejected(404, 'Demo write route not found.');
    if (path === '/api/jobs/runs') return 'job';
    if (path === '/api/fleet/captures') return 'capture';
    throw rejected(404, 'Demo write route not found.');
  }
  if (path === '/' || path === '/index.html'
    || /^\/assets\/[a-zA-Z0-9_-]+\.(js|css|png|svg|webp|jpg|gif|woff2?|ico)$/.test(path) && !url.search) return 'read';
  if (method === 'HEAD') throw rejected(405, 'HEAD is supported only for built assets.');
  if (path === '/__demo/status' && !url.search) return 'status';
  if ((path === '/api/weather/sites' || path === '/api/jobs/context' || runPath.test(path)) && !url.search) return 'read';
  if (/^\/api\/grid\/(eia|caiso)$/.test(path) && validRevisionQuery(url)) return 'read';
  if (path === '/api/fleet/captures' && validRevisionQuery(url, true)) return 'read';
  throw rejected(404, 'Demo route not found.');
}
function createWriteBudget(limits, now) {
  const attempts = [];
  let jobs = 0, captures = 0, captureBytes = 0;
  return {
    admit() {
      const time = now();
      while (attempts.length && attempts[0] <= time - 60_000) attempts.shift();
      if (attempts.length >= limits.postsPerMinute) throw rejected(429, 'The demo write limit is busy. Please wait a minute and try again.');
      attempts.push(time);
    },
    reserve(kind, bytes) {
      if (kind === 'job') {
        if (jobs >= limits.jobs) throw rejected(429, 'The demo job budget is exhausted. Existing results remain available; contact the presenter.');
        jobs++;
      } else {
        if (captures >= limits.captures || captureBytes + bytes > limits.captureBytes) {
          throw rejected(429, 'The demo capture budget is exhausted. Existing captures remain available; contact the presenter.');
        }
        captures++;
        captureBytes += bytes;
      }
    },
  };
}
function readBody(request, maximumBytes, timeoutMs) {
  if (Number(request.headers['content-length']) > maximumBytes) return Promise.reject(rejected(413, 'Demo request body is too large.'));
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', data); request.off('end', end);
      request.off('error', fail); request.off('aborted', aborted);
    };
    const fail = error => { cleanup(); request.pause(); rejectBody(error); };
    const aborted = () => fail(rejected(400, 'Demo request was interrupted.'));
    const data = part => {
      bytes += part.length;
      if (bytes > maximumBytes) { fail(rejected(413, 'Demo request body is too large.')); return; }
      chunks.push(part);
    };
    const end = () => { cleanup(); resolveBody(Buffer.concat(chunks, bytes)); };
    const timer = setTimeout(() => fail(rejected(408, 'Demo upload timed out. Please retry.')), timeoutMs);
    request.on('data', data); request.once('end', end);
    request.once('error', fail); request.once('aborted', aborted);
  });
}
function forward(request, response, target, body, timeoutMs) {
  return new Promise((done, fail) => {
    // Reconstruct a minimal request. Public cookies, credentials and proxy headers never cross this boundary.
    const headers = { host: target.host, accept: '*/*', connection: 'close' };
    if (body) Object.assign(headers, { origin: target.origin, 'content-type': 'application/json', 'content-length': body.length });
    const outgoing = http.request({
      hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 80,
      path: request.url, method: request.method, headers,
    }, incoming => {
      const safeHeaders = {};
      for (const name of responseHeaders) if (incoming.headers[name] !== undefined) safeHeaders[name] = incoming.headers[name];
      response.writeHead(incoming.statusCode ?? 502, safeHeaders);
      incoming.on('error', fail);
      incoming.once('end', done);
      incoming.pipe(response);
    });
    const timer = setTimeout(() => outgoing.destroy(rejected(504, 'The demo host took too long to respond. Please retry.')), timeoutMs);
    const disconnected = () => outgoing.destroy();
    response.once('close', disconnected);
    outgoing.once('error', fail);
    outgoing.once('close', () => { clearTimeout(timer); response.off('close', disconnected); });
    outgoing.end(body);
  });
}
const deploymentStates = ['starting', 'watching', 'building', 'preflighting', 'waiting-for-worker', 'switching', 'failed', 'stopped'];
async function publicDeploymentStatus(readStatus) {
  try {
    const value = await readStatus?.();
    const validCommit = commit => commit === null || typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit);
    if (!value || !validCommit(value.activeCommit) || !validCommit(value.lastAttemptedCommit)
      || !deploymentStates.includes(value.status) || typeof value.updateFailed !== 'boolean'
      || value.deployedAt !== null && (typeof value.deployedAt !== 'string' || new Date(value.deployedAt).toISOString() !== value.deployedAt)) throw new Error('Invalid status');
    return { activeCommit: value.activeCommit, status: value.status, lastAttemptedCommit: value.lastAttemptedCommit,
      deployedAt: value.deployedAt, updateFailed: value.updateFailed };
  } catch { throw rejected(503, 'Deployment status is unavailable. Please retry shortly.'); }
}
async function readStatusFile(filename) {
  const file = await open(filename, 'r');
  try {
    if (!(await file.stat()).isFile() || (await file.stat()).size > 65_536) throw new Error('Invalid status file');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}
function sendFailure(response, error) {
  if (response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  const status = error.status ?? 502;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close',
    ...(status === 429 ? { 'retry-after': '60' } : {}),
  });
  response.end(JSON.stringify({ error: error.status ? error.message : 'The demo host is restarting or unavailable. Please retry shortly.' }));
}

/** Public HTTPS admission in front of one fixed, loopback-only built application.
 * Lifetime budgets deliberately count upstream failures too: uncertain writes are never refunded.
 */
export function createDemoGateway({ publicOrigin, upstream = 'http://127.0.0.1:5200', limits: suppliedLimits, now = Date.now, deploymentStatus }) {
  const { origin, target, limits } = configuration(publicOrigin, upstream, suppliedLimits);
  const budget = createWriteBudget(limits, now);
  let active = 0;
  const server = http.createServer({ maxHeaderSize: 8192, headersTimeout: Math.min(10_000, limits.readTimeoutMs) }, (request, response) => {
    void (async () => {
      if (request.headers.host !== origin.host) throw rejected(403, 'Use the exact public demo hostname.');
      const route = routeFor(request);
      if (active >= limits.concurrent) throw rejected(429, 'The demo is busy. Please retry shortly.');
      active++;
      response.once('close', () => { active--; });
      let body;
      if (route === 'status') {
        const status = await publicDeploymentStatus(deploymentStatus);
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(status));
        return;
      }
      if (route !== 'read') {
        if (request.headers.origin !== publicOrigin) throw rejected(403, 'Demo writes require the exact public HTTPS origin.');
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw rejected(415, 'Use application/json.');
        budget.admit();
        body = await readBody(request, route === 'job' ? limits.jobBodyBytes : limits.captureBodyBytes, limits.readTimeoutMs);
        if (deploymentStatus) {
          const status = await publicDeploymentStatus(deploymentStatus);
          if (['starting', 'waiting-for-worker', 'switching', 'stopped'].includes(status.status)) {
            throw rejected(503, 'The demo is updating. Existing results remain available; retry this action shortly.');
          }
        }
        budget.reserve(route, body.length);
      }
      await forward(request, response, target, body, limits.upstreamTimeoutMs);
    })().catch(error => sendFailure(response, error));
  });
  server.requestTimeout = limits.readTimeoutMs;
  server.timeout = limits.readTimeoutMs + limits.upstreamTimeoutMs;
  server.keepAliveTimeout = 5000;
  server.maxConnections = limits.concurrent * 2;
  server.maxRequestsPerSocket = 100;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = { upstream: 'http://127.0.0.1:5200', port: 5198 };
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index], value = args[index + 1];
      if (!['--origin', '--upstream', '--port', '--status-file'].includes(key) || !value) throw new Error('Usage: demo-gateway.mjs --origin https://public-host [--upstream http://127.0.0.1:5200] [--port 5198] [--status-file runtime/status.json]');
      if (key === '--origin') options.publicOrigin = value;
      else if (key === '--upstream') options.upstream = value;
      else if (key === '--status-file') options.deploymentStatus = () => readStatusFile(resolve(value));
      else options.port = Number(value);
    }
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('The gateway port must be between 1 and 65535.');
    const gateway = createDemoGateway(options);
    gateway.on('error', () => { console.error('Demo gateway could not listen on its loopback port.'); process.exitCode = 1; });
    gateway.listen(options.port, '127.0.0.1', () => console.log('Demo gateway ready on 127.0.0.1:' + options.port + ' for ' + options.publicOrigin));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      gateway.close(); gateway.closeAllConnections();
    });
  } catch (error) { console.error(error instanceof TypeError ? 'Supply a valid --origin HTTPS URL.' : error.message); process.exitCode = 1; }
}
