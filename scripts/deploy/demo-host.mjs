import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const { values } = parseArgs({ options: {
  runtime: { type: 'string' }, cloudflared: { type: 'string' },
  'npm-cli': { type: 'string' }, 'env-file': { type: 'string' },
} });
for (const name of ['runtime', 'cloudflared', 'npm-cli', 'env-file']) {
  if (!values[name]) throw new Error(`Missing --${name}`);
}
if (!process.versions.node.startsWith('24.')) throw new Error('The demo requires the pinned Node 24 runtime.');

const runtime = resolve(values.runtime);
const scripts = dirname(fileURLToPath(import.meta.url));
const children = new Map();
const streams = [];
let stopping = false;
await mkdir(join(runtime, 'logs'), { recursive: true });

function isRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const lockPath = join(runtime, 'host.lock');
try {
  const existing = JSON.parse(await readFile(lockPath, 'utf8'));
  if (isRunning(existing.pid)) throw new Error(`A demo host is already running (PID ${existing.pid}).`);
  await rm(lockPath);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const lock = await open(lockPath, 'wx');
await lock.writeFile(JSON.stringify({ pid: process.pid }));
await lock.close();
await rm(join(runtime, 'stop.request'), { force: true });

function child(name, executable, args, env = process.env) {
  const log = createWriteStream(join(runtime, 'logs', `${name}.log`), { flags: 'a' });
  streams.push(log);
  const running = spawn(executable, args, {
    cwd: runtime, env, windowsHide: true,
    stdio: name === 'updater' ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  running.stdout.pipe(log, { end: false });
  running.stderr.pipe(log, { end: false });
  children.set(name, running);
  running.on('error', error => {
    console.error(`${name} could not start: ${error.message}`);
    void shutdown(1);
  });
  running.on('exit', code => {
    if (!stopping) {
      console.error(`${name} exited (${code}); stopping this demo session.`);
      void shutdown(1);
    }
  });
  return running;
}

async function stopChild(name) {
  const running = children.get(name);
  if (!running || running.exitCode !== null || running.signalCode !== null) return;
  await new Promise(done => {
    const timer = setTimeout(() => { running.kill('SIGKILL'); done(); }, name === 'updater' ? 360_000 : 12_000);
    running.once('exit', () => { clearTimeout(timer); done(); });
    if (running.connected) running.send('shutdown');
    else running.kill('SIGTERM');
  });
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopWatcher);
  for (const name of ['cloudflared', 'gateway', 'updater']) await stopChild(name);
  await rm(lockPath, { force: true });
  await rm(join(runtime, 'stop.request'), { force: true });
  await writeFile(join(runtime, 'host-stopped.json'), JSON.stringify({ stoppedAt: new Date().toISOString(), code }));
  for (const stream of streams) stream.end();
  process.exit(code);
}

const stopWatcher = setInterval(async () => {
  try { await readFile(join(runtime, 'stop.request')); void shutdown(0); }
  catch (error) { if (error.code !== 'ENOENT') console.error('Could not read the local stop request.'); }
}, 1000);
process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

try {
  const configuration = parseEnv(await readFile(resolve(values['env-file']), 'utf8'));
  const apiKey = process.env.EIA_API_KEY ?? configuration.EIA_API_KEY;
  if (!apiKey) throw new Error('The existing local configuration must contain EIA_API_KEY.');
  const runtimeEnv = { ...process.env, EIA_API_KEY: apiKey };
  const publicEnv = { ...process.env };
  delete publicEnv.EIA_API_KEY;

  child('updater', process.execPath, [join(scripts, 'demo-updater.mjs'),
    '--runtime', runtime, '--npm-cli', resolve(values['npm-cli']),
    '--port', '5200', '--preflight-port', '5201'], runtimeEnv);

  const tunnel = child('cloudflared', resolve(values.cloudflared), [
    'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:5198',
  ], publicEnv);
  const publicOrigin = await new Promise((resolveOrigin, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Cloudflare did not provide a demo URL within 60 seconds.')), 60_000);
    const inspect = part => {
      output = (output + part.toString()).slice(-16_000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (match) { clearTimeout(timeout); resolveOrigin(match[0]); }
    };
    tunnel.stdout.on('data', inspect);
    tunnel.stderr.on('data', inspect);
    tunnel.once('exit', () => { clearTimeout(timeout); reject(new Error('The Cloudflare tunnel stopped before receiving a URL.')); });
  });
  child('gateway', process.execPath, [join(scripts, 'demo-gateway.mjs'),
    '--origin', publicOrigin, '--upstream', 'http://127.0.0.1:5200',
    '--port', '5198', '--status-file', join(runtime, 'status.json')], publicEnv);
  const session = {
    publicOrigin, startedAt: new Date().toISOString(), hostPid: process.pid,
    processes: Object.fromEntries([...children].map(([name, process]) => [name, process.pid])),
    statusUrl: `${publicOrigin}/__demo/status`,
  };
  await writeFile(join(runtime, 'host.json'), JSON.stringify(session, null, 2) + '\n');
  console.log(`Judges URL: ${publicOrigin}`);
  console.log(`Deployment status: ${session.statusUrl}`);
  console.log('Main updates build automatically; this tunnel stays running during application updates.');
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}
