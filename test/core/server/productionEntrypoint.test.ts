import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

test('the shipped entrypoint starts with native Node and serves the protected built UI without Vite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunchaser-native-host-'));
  await mkdir(join(directory, 'dist'));
  await writeFile(join(directory, 'dist/index.html'), '<html>native production UI</html>');
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  const env = {
    PORT: String(port), HOST: '127.0.0.1', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    EIA_API_KEY: 'unused-test-key-no-upstream-call', DEMO_USERNAME: 'judge', DEMO_PASSWORD: 'native-entrypoint-test-password',
    DIST_DIRECTORY: join(directory, 'dist'), GRID_SNAPSHOT_DIR: join(directory, 'grid'), JOB_RUN_DIRECTORY: join(directory, 'jobs'),
    ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const child = spawn(process.execPath, [join(repository, 'src/server/start.ts')], {
    cwd: repository, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const record = (part: Buffer) => { log = (log + part.toString()).slice(-4000); };
  child.stdout.on('data', record); child.stderr.on('data', record);
  let exited = false;
  const ended = new Promise<void>(done => child.once('close', () => { exited = true; done(); }));
  try {
    let ready = false;
    const deadline = Date.now() + 10_000;
    while (!exited && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.json()).status === 'ok') { ready = true; break; }
      } catch { /* The native process can be alive before its listener starts. */ }
      await delay(25);
    }
    expect(ready, `Native production entrypoint failed to become ready: ${log}`).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(401);
    const response = await fetch(`http://127.0.0.1:${port}/`, { headers: {
      authorization: `Basic ${Buffer.from(`${env.DEMO_USERNAME}:${env.DEMO_PASSWORD}`).toString('base64')}`,
    } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>native production UI</html>');
    expect(log).not.toContain(env.EIA_API_KEY);
    expect(log).not.toContain(env.DEMO_PASSWORD);
  } finally {
    if (!exited) child.kill('SIGTERM');
    await Promise.race([ended, delay(3000, undefined, { ref: false })]);
    if (!exited) { child.kill('SIGKILL'); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
