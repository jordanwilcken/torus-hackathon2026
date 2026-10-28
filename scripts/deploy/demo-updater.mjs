import { spawn } from 'node:child_process';
import { open, mkdir, readFile, writeFile, rename, access, unlink, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository = 'https://github.com/jordanwilcken/torus-hackathon2026.git';
const revisionPattern = /^[a-f0-9]{40}$/;
const updaterScript = fileURLToPath(import.meta.url);

/** Build and preflight without disturbing the current release; roll back a failed switch. */
export function createReleaseUpdater(actions, initial = null) {
  let active = initial, lastGood = initial, operation = null, lastAttemptedCommit = null, lastFailure = null;
  let deployedAt = initial?.deployedAt ?? null;
  const snapshot = status => ({
    status, activeCommit: active?.commit ?? null, lastAttemptedCommit,
    deployedAt, updateFailed: lastFailure !== null, lastFailure,
    releaseDirectory: active?.directory ?? null, previewPid: active?.child?.pid ?? null,
    lastWorkingCommit: lastGood?.commit ?? null,
  });
  const report = status => actions.report?.(snapshot(status));
  async function update(commit) {
    const previous = active;
    let previousStopped = false;
    lastAttemptedCommit = commit;
    lastFailure = null;
    try {
      await report('building');
      const release = await actions.prepare(commit);
      await report('preflighting');
      await actions.preflight(release);
      if (previous) {
        await report('waiting-for-worker');
        await actions.awaitIdle(previous);
        await report('switching');
        await actions.stop(previous);
        previousStopped = true;
        active = null;
      } else await report('switching');
      active = await actions.start(release);
      lastGood = active;
      deployedAt = new Date().toISOString();
      await report('watching');
      return { changed: true, ...snapshot('watching') };
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'Deployment failed';
      if (previousStopped) {
        if (active) { await actions.stop(active); active = null; }
        try { active = await actions.start(previous); lastGood = active; }
        catch (rollbackError) {
          active = null;
          lastFailure += '; rollback failed: ' + (rollbackError instanceof Error ? rollbackError.message : 'unknown error');
        }
      }
      await report('failed');
      return { changed: false, ...snapshot('failed') };
    }
  }
  return {
    get active() { return active; },
    snapshot() { return snapshot(lastFailure ? 'failed' : 'watching'); },
    recover() {
      if (operation) return operation;
      if (!lastGood) return Promise.resolve(false);
      operation = (async () => {
        active = null;
        await report('starting');
        try {
          active = await actions.start(lastGood);
          lastGood = active;
          await report(lastFailure ? 'failed' : 'watching');
          return true;
        } catch (error) {
          lastFailure = 'Recovery failed: ' + error.message;
          await report('failed');
          return false;
        }
      })().finally(() => { operation = null; });
      return operation;
    },
    update(commit) {
      if (!revisionPattern.test(commit)) return Promise.reject(new Error('Expected an exact main commit SHA'));
      if (operation) return operation;
      if (commit === active?.commit || commit === lastAttemptedCommit) {
        return Promise.resolve({ changed: false, ...snapshot(lastFailure ? 'failed' : 'watching') });
      }
      operation = update(commit).finally(() => { operation = null; });
      return operation;
    },
  };
}

function requiredArgument(values, name) {
  const value = values[name];
  if (!value) throw new Error('Missing --' + name);
  return value;
}
function argumentsFor(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Expected --name value arguments');
    if (key.slice(2) in values) throw new Error('Duplicate option: ' + key);
    values[key.slice(2)] = argv[index + 1];
  }
  return values;
}
function integerOption(value, fallback, minimum, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error('Invalid numeric deployment option');
  return number;
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function saveJson(path, value) {
  const temporary = path + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, path);
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
async function ownRuntime(runtime) {
  await mkdir(runtime, { recursive: true });
  const lockPath = join(runtime, 'updater.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(lockPath, 'utf8'));
    if (processAlive(previous.pid)) throw new Error('This runtime already has an updater. No existing process was stopped.');
    await unlink(lockPath);
    lock = await open(lockPath, 'wx');
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, repository }));
  await lock.close();
  return async () => {
    const owner = JSON.parse(await readFile(lockPath, 'utf8'));
    if (owner.pid === process.pid) await unlink(lockPath);
  };
}

/** npm's unpacked Windows wrappers assume an installed layout; use the supplied CLI directly. */
export async function createPackageManagerLaunchers(directory, npmCli) {
  await mkdir(directory, { recursive: true });
  const quotedForShell = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const quotedForBatch = value => {
    if (/["\r\n]/.test(value)) throw new Error('A package-manager path cannot contain quotes or newlines');
    return '"' + value.replaceAll('%', '%%') + '"';
  };
  for (const [name, cli] of [['npm', resolve(npmCli)], ['npx', join(dirname(resolve(npmCli)), 'npx-cli.js')]]) {
    await access(cli);
    if (process.platform === 'win32') {
      const text = '@ECHO OFF\r\nSETLOCAL DisableDelayedExpansion\r\n' +
        quotedForBatch(process.execPath) + ' ' + quotedForBatch(cli) + ' %*\r\nEXIT /B %ERRORLEVEL%\r\n';
      await writeFile(join(directory, name + '.cmd'), text, 'utf8');
    } else {
      const path = join(directory, name);
      await writeFile(path, '#!/bin/sh\nexec ' + quotedForShell(process.execPath) + ' ' + quotedForShell(cli) + ' "$@"\n', { mode: 0o755 });
      await chmod(path, 0o755);
    }
  }
}

/** Build tools cannot inherit the server API key or unrelated deployment credentials. */
export function buildEnvironment(npmCli, cacheDirectory, source = process.env, launcherDirectory = dirname(npmCli)) {
  const names = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'];
  const environment = {};
  for (const key of names) if (source[key] !== undefined) environment[key] = source[key];
  environment.PATH = [launcherDirectory, dirname(process.execPath), source.PATH ?? source.Path ?? ''].join(delimiter);
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.NPM_CONFIG_CACHE = cacheDirectory;
  environment.CI = '1';
  return environment;
}
async function command(executable, args, options) {
  const { logPath, ...spawnOptions } = options;
  const log = await open(logPath, 'a');
  return new Promise((resolveCommand, reject) => {
    let output = '', finished = false, writes = Promise.resolve(), logError = null;
    const child = spawn(executable, args, { ...spawnOptions, timeout: 300_000, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = async error => {
      if (finished) return;
      finished = true;
      await writes;
      try { await log.close(); } catch (failure) { logError ??= failure; }
      if (error || logError) reject(error ?? new Error('Could not write the local deployment log'));
      else resolveCommand(output.trim());
    };
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-64_000); writes = writes.then(() => log.write(chunk)).catch(error => { logError ??= error; }); });
    child.stderr.on('data', chunk => { writes = writes.then(() => log.write(chunk)).catch(error => { logError ??= error; }); });
    child.once('error', () => { void finish(new Error('Could not start ' + executable)); });
    child.once('close', code => { void finish(code === 0 ? null : new Error(executable + ' failed; see the local deployment log')); });
  });
}
async function portIsFree(port) {
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('Port ' + port + ' is already occupied; no unknown process was stopped')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolvePort));
  });
}
async function jsonAt(base, pathname) {
  const response = await fetch(base + pathname, { signal: AbortSignal.timeout(35_000) });
  if (!response.ok) throw new Error(pathname + ' returned HTTP ' + response.status);
  return response.json();
}
/** Verify the served application and its API contracts; an upstream outage is not a broken build. */
export async function checkPreview(base) {
  const page = await fetch(base + '/', { signal: AbortSignal.timeout(10_000) });
  const html = await page.text();
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  if (!page.ok || !script) throw new Error('Preview did not serve the built application');
  const asset = await fetch(base + script, { signal: AbortSignal.timeout(10_000) });
  if (!asset.ok || !asset.headers.get('content-type')?.includes('javascript')) throw new Error('Preview did not serve the built application assets');
  await asset.arrayBuffer();
  const [context, weather] = await Promise.all([jsonAt(base, '/api/jobs/context'), jsonAt(base, '/api/weather/sites')]);
  if (context?.mode !== 'live' || typeof context.busy !== 'boolean' || !context.inputs?.eia || !context.inputs?.caiso ||
      typeof context.inputs.eia.status !== 'string' || typeof context.inputs.caiso.status !== 'string') {
    throw new Error('Preview did not serve the execution and public-feed API');
  }
  if (typeof weather?.status !== 'string' || !('snapshot' in weather)) throw new Error('Preview did not serve the weather API');
}
async function stopPreview(release) {
  const child = release?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveStop, reject) => {
    const force = setTimeout(() => child.kill(), 5_000);
    const expired = setTimeout(() => { clearTimeout(force); reject(new Error('Owned preview did not stop')); }, 10_000);
    child.once('exit', () => { clearTimeout(force); clearTimeout(expired); resolveStop(); });
    if (child.connected) child.send('shutdown');
    else child.kill();
  });
}
async function startPreview(release, { port, gridDirectory, jobsDirectory, environment, logDirectory }) {
  await portIsFree(port);
  await mkdir(jobsDirectory, { recursive: true });
  const stdout = await open(join(logDirectory, 'preview-' + port + '.log'), 'a');
  const child = spawn(process.execPath, [updaterScript, 'serve', '--release', release.directory, '--port', String(port), '--owner', String(process.pid)], {
    cwd: release.directory, windowsHide: true, shell: false, stdio: ['ignore', stdout.fd, stdout.fd, 'ipc'],
    env: { ...environment, GRID_SNAPSHOT_DIR: gridDirectory, JOB_RUN_DIRECTORY: jobsDirectory, EIA_API_KEY: process.env.EIA_API_KEY ?? '' },
  });
  await stdout.close();
  const running = { ...release, child, port };
  const base = 'http://127.0.0.1:' + port;
  try {
    let listening = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Preview exited before health checks passed');
      try {
        const response = await fetch(base + '/', { signal: AbortSignal.timeout(1000) });
        if (response.ok) { listening = true; break; }
      } catch (error) {
        if (attempt === 29) throw error;
      }
      await delay(500);
    }
    if (!listening) throw new Error('Preview health check timed out');
    await checkPreview(base);
    return running;
  } catch (error) { await stopPreview(running); throw error; }
}
async function idlePreview(release) {
  let quiet = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const context = await jsonAt('http://127.0.0.1:' + release.port, '/api/jobs/context');
    quiet = context.busy === false ? quiet + 1 : 0;
    if (quiet === 2) return;
    await delay(500);
  }
  throw new Error('The local worker is still busy; update deferred without stopping it');
}

async function serve(values) {
  const directory = resolve(requiredArgument(values, 'release'));
  const port = integerOption(values.port, 5200, 1024, 65535);
  const owner = integerOption(values.owner, undefined, 1, Number.MAX_SAFE_INTEGER);
  process.chdir(directory);
  const { preview } = await import(pathToFileURL(join(directory, 'node_modules/vite/dist/node/index.js')).href);
  const server = await preview({ root: directory, preview: { host: '127.0.0.1', port, strictPort: true } });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(ownerCheck);
    server.httpServer.closeIdleConnections?.();
    await new Promise(resolveClose => server.httpServer.close(resolveClose));
    await new Promise(resolveClose => setImmediate(resolveClose));
    process.exit(0);
  };
  const ownerCheck = setInterval(() => { if (!processAlive(owner)) void close(); }, 2000);
  process.on('message', message => { if (message === 'shutdown') void close(); });
  process.on('disconnect', () => { void close(); });
  process.on('SIGTERM', () => { void close(); });
  process.on('SIGINT', () => { void close(); });
}

export async function runUpdater(values) {
  const runtime = resolve(requiredArgument(values, 'runtime'));
  const npmCli = resolve(requiredArgument(values, 'npm-cli'));
  const interval = integerOption(values['interval-ms'], 60_000, 1000, 3_600_000);
  const port = integerOption(values.port, 5200, 1024, 65535);
  const preflightPort = integerOption(values['preflight-port'], 5201, 1024, 65535);
  if (port === preflightPort) throw new Error('Production and preflight ports must differ');
  await access(npmCli);
  const releaseOwnership = await ownRuntime(runtime);
  const mirror = join(runtime, 'source.git'), releases = join(runtime, 'releases');
  const logDirectory = join(runtime, 'logs'), gridDirectory = join(runtime, 'data', 'grid');
  const jobsDirectory = join(runtime, 'data', 'jobs'), statusPath = join(runtime, 'status.json');
  for (const directory of [releases, logDirectory, gridDirectory, jobsDirectory]) await mkdir(directory, { recursive: true });
  const launcherDirectory = join(runtime, 'bin');
  await createPackageManagerLaunchers(launcherDirectory, npmCli);
  const environment = buildEnvironment(npmCli, join(runtime, 'npm-cache'), process.env, launcherDirectory);
  const npmConfig = join(runtime, 'npmrc');
  await writeFile(npmConfig, 'registry=https://registry.npmjs.org/\n', 'utf8');
  environment.NPM_CONFIG_USERCONFIG = npmConfig;
  const gitLog = join(logDirectory, 'source.log');
  const git = (...args) => command('git', args, { cwd: runtime, env: environment, logPath: gitLog });
  let stopped = false, updater, currentOperation;
  const report = state => saveJson(statusPath, { ...state, updaterPid: process.pid, checkedAt: new Date().toISOString() });
  const previewOptions = { gridDirectory, jobsDirectory, environment, logDirectory };
  const actions = {
    async prepare(commit) {
      const directory = join(releases, commit), marker = join(directory, '.demo-built.json');
      if (await exists(marker) && await exists(join(directory, 'dist', 'index.html'))) return { commit, directory };
      await mkdir(directory, { recursive: true });
      const archive = join(runtime, commit + '.tar');
      await git('--git-dir=' + mirror, 'archive', '--format=tar', '--output=' + archive, commit);
      const logPath = join(logDirectory, 'build-' + commit + '.log');
      await command('tar', ['-xf', archive, '-C', directory], { cwd: runtime, env: environment, logPath });
      await unlink(archive);
      await command(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: directory, env: environment, logPath });
      await command(process.execPath, [npmCli, 'run', 'build'], { cwd: directory, env: environment, logPath });
      await saveJson(marker, { commit, builtAt: new Date().toISOString() });
      return { commit, directory };
    },
    async preflight(release) {
      if (stopped) throw new Error('Updater is stopping');
      const running = await startPreview(release, { ...previewOptions, port: preflightPort, jobsDirectory: join(release.directory, '.cache', 'preflight-jobs') });
      await stopPreview(running);
    },
    awaitIdle: idlePreview, stop: stopPreview,
    start(release) {
      if (stopped) throw new Error('Updater is stopping');
      return startPreview(release, { ...previewOptions, port });
    },
    report,
  };
  async function stop() {
    if (stopped) return;
    stopped = true;
    await currentOperation?.catch(() => {});
    await stopPreview(updater?.active);
    await report({ ...(updater?.snapshot() ?? {}), status: 'stopped', previewPid: null });
    await releaseOwnership();
    if (process.connected) process.disconnect();
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  process.on('message', message => { if (message === 'shutdown') void stop(); });
  process.once('disconnect', () => { void stop(); });
  try {
    if (!await exists(mirror)) {
      await git('init', '--bare', mirror);
      await git('--git-dir=' + mirror, 'remote', 'add', 'origin', repository);
    }
    if (await git('--git-dir=' + mirror, 'remote', 'get-url', 'origin') !== repository) throw new Error('Runtime mirror has an unexpected remote');
    let previous = null;
    if (await exists(statusPath)) {
      const saved = JSON.parse(await readFile(statusPath, 'utf8'));
      const commit = saved.activeCommit ?? saved.lastWorkingCommit;
      if (revisionPattern.test(commit ?? '') && await exists(join(releases, commit, '.demo-built.json'))) {
        const release = { commit, directory: join(releases, commit), deployedAt: saved.deployedAt };
        previous = await actions.start(release);
      }
    }
    updater = createReleaseUpdater(actions, previous);
    await report({ ...updater.snapshot(), status: 'watching' });
    while (!stopped) {
      currentOperation = (async () => {
        try {
          if (!updater.active || updater.active.child && (updater.active.child.exitCode !== null || updater.active.child.signalCode !== null)) {
            await updater.recover();
          }
          await git('--git-dir=' + mirror, 'fetch', '--depth=1', 'origin', 'main');
          const commit = await git('--git-dir=' + mirror, 'rev-parse', 'FETCH_HEAD');
          await updater.update(commit);
        } catch (error) {
          await report({ ...updater.snapshot(), status: 'failed', updateFailed: true, lastFailure: error.message });
        }
      })();
      await currentOperation;
      for (let waited = 0; !stopped && waited < interval; waited += 1000) await delay(Math.min(1000, interval - waited));
    }
  } finally {
    if (!stopped) await stop();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === updaterScript) {
  const serving = process.argv[2] === 'serve';
  const args = argumentsFor(process.argv.slice(serving ? 3 : 2));
  (serving ? serve(args) : runUpdater(args)).catch(error => { console.error('Demo deployment failed: ' + error.message); process.exitCode = 1; });
}
