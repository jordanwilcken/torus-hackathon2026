import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import type { LocalRun, LocalRunRequest } from '../../../src/data/LocalRun.type';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const directoryPrefix = 'sunchaser-server-restart-';

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No local test port was assigned');
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  return address.port;
}

async function within<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned server did not stop in time')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function startRecordedServer(directory: string, port: number) {
  // Whitelist only runtime mechanics: no EIA key, token, NODE_OPTIONS, or live-source configuration.
  const env: NodeJS.ProcessEnv = {
    LOCAL_RUN_TEST_DIRECTORY: directory, GRID_FEEDS_OFFLINE: '1', NODE_ENV: 'test',
    TEMP: tmpdir(), TMP: tmpdir(),
    ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const child = spawn(process.execPath, [join(repository, 'node_modules/vite/bin/vite.js'),
    '--config', 'test/userflows/execution/vite.config.ts', '--host', '127.0.0.1',
    '--port', String(port), '--strictPort'], {
    cwd: repository, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  let exited = false;
  let startupError = false;
  const capture = (part: Buffer) => { log = (log + part.toString()).slice(-8_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', () => { startupError = true; });
  const ended = new Promise<void>(done => child.once('close', () => { exited = true; done(); }));
  const baseUrl = `http://127.0.0.1:${port}`;
  async function stop() {
    if (exited) return;
    child.kill('SIGTERM');
    try { await within(ended, 3_000); }
    catch { child.kill('SIGKILL'); await within(ended, 3_000); }
  }
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !exited && !startupError) {
      try {
        const response = await fetch(`${baseUrl}/api/jobs/context`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return { baseUrl, pid: child.pid!, stop };
      } catch { /* An owned process can be alive before its HTTP listener is ready. */ }
      await delay(50);
    }
    // This child receives no credentials; additionally scrub recognizable credential assignments.
    const safeLog = log.replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
    throw new Error(`Recorded test server did not become ready. ${safeLog}`);
  } catch (error) { await stop(); throw error; }
}

async function json<T>(baseUrl: string, path: string, expectedStatus = 200, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(2_000),
  });
  expect(response.status, `${path} status`).toBe(expectedStatus);
  return await response.json() as T;
}

async function completedRun(baseUrl: string, requestId: string): Promise<LocalRun> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const run = await json<LocalRun>(baseUrl, `/api/jobs/runs/${requestId}`);
    if (run.status !== 'queued' && run.status !== 'running') return run;
    await delay(25);
  }
  throw new Error('The actual local job did not finish in time');
}

async function output(baseUrl: string, requestId: string) {
  const response = await fetch(`${baseUrl}/api/jobs/runs/${requestId}/output`, { signal: AbortSignal.timeout(2_000) });
  expect(response.status).toBe(200);
  return { text: await response.text(), sha256: response.headers.get('X-Output-SHA256') };
}

test('an actual server restart preserves a completed receipt and output, and duplicate submission does not execute again', async () => {
  const directory = await mkdtemp(join(tmpdir(), directoryPrefix));
  const servers: Array<Awaited<ReturnType<typeof startRecordedServer>>> = [];
  try {
    const port = await availablePort();
    const first = await startRecordedServer(directory, port);
    servers.push(first);
    const context = await json<{ mode: string; inputs: { eia: { revision: string }; caiso: { revision: string } } }>(first.baseUrl, '/api/jobs/context');
    expect(context.mode).toBe('recorded');
    const request: LocalRunRequest = {
      requestId: randomUUID(), workload: { kind: 'integer-sum', values: [1, 2, 3, 4] },
      inputRevisions: { eia: context.inputs.eia.revision, caiso: context.inputs.caiso.revision },
      policy: { maximumDemandMW: 20_000, maximumWholesaleUsdPerMWh: 1_000, maximumAgeMinutes: { eia: 180, caiso: 20 } },
      model: { computeKWh: 1, roundTripEfficiency: 0.9 },
    };
    await json(first.baseUrl, '/api/jobs/runs', 202, request);
    const original = await completedRun(first.baseUrl, request.requestId);
    expect(original.status).toBe('done');
    expect(original.request.inputRevisions).toEqual(request.inputRevisions);
    expect(original.execution).toMatchObject({ backend: 'node-child-process', simulated: false, exitCode: 0 });
    expect(original.execution.pid).toBeGreaterThan(0);
    expect(original.execution.pid).not.toBe(first.pid);
    expect(original.execution.startedAt).not.toBeNull();
    expect(original.execution.completedAt).not.toBeNull();
    const originalOutput = await output(first.baseUrl, request.requestId);
    expect(JSON.parse(originalOutput.text)).toEqual({ requestId: request.requestId, sum: 10 });
    expect(originalOutput.sha256).toBe(createHash('sha256').update(originalOutput.text).digest('hex'));
    expect(original.execution.output).toMatchObject({ id: originalOutput.sha256, text: originalOutput.text });

    await first.stop();
    const restarted = await startRecordedServer(directory, port);
    servers.push(restarted);
    expect(restarted.pid).not.toBe(first.pid);
    // The second process has received no execution POST before these reads.
    expect(await json<LocalRun>(restarted.baseUrl, `/api/jobs/runs/${request.requestId}`)).toEqual(original);
    expect(await output(restarted.baseUrl, request.requestId)).toEqual(originalOutput);

    const duplicate = await json<LocalRun>(restarted.baseUrl, '/api/jobs/runs', 202, {
      model: request.model, policy: request.policy, inputRevisions: request.inputRevisions,
      workload: request.workload, requestId: request.requestId,
    });
    expect(duplicate).toEqual(original);
    expect(await json<{ busy: boolean }>(restarted.baseUrl, '/api/jobs/context')).toMatchObject({ busy: false });
    expect(await json<LocalRun>(restarted.baseUrl, `/api/jobs/runs/${request.requestId}`)).toEqual(original);
    expect(await output(restarted.baseUrl, request.requestId)).toEqual(originalOutput);
  } finally {
    for (const server of servers.reverse()) await server.stop();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(directoryPrefix)) throw new Error('Refusing to remove an unowned test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 45_000);
