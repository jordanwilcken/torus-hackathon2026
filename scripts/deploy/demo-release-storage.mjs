import { lstat, realpath, readdir, open, readFile, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

const repository = 'https://github.com/jordanwilcken/torus-hackathon2026.git';
const commitPattern = /^[a-f0-9]{40}$/;
const confirmedStates = new Set(['watching', 'building', 'preflighting', 'failed']);
const lockKind = 'sunchaser-release-retention';
const samePath = (left, right) => process.platform === 'win32'
  ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
  : resolve(left) === resolve(right);

async function ordinaryPath(path, directory) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || !samePath(await realpath(path), path)) {
    throw new Error('Retention refuses a redirected or unexpected filesystem path');
  }
  return stat;
}
async function jsonFile(path) {
  const stat = await ordinaryPath(path, false);
  if (stat.size > 65_536) throw new Error('Retention metadata is too large');
  return JSON.parse(await readFile(path, 'utf8'));
}
function pathsFor(options) {
  const runtime = resolve(options.runtimeDirectory), release = resolve(options.releaseDirectory);
  const releases = join(runtime, 'releases'), commit = basename(release);
  if (!commitPattern.test(commit) || !samePath(dirname(release), releases) ||
      !samePath(options.gridDirectory, join(runtime, 'data', 'grid')) ||
      !samePath(options.jobsDirectory, join(runtime, 'data', 'jobs'))) {
    throw new Error('Retention requires the managed production release and data directories');
  }
  if (![options.ownerPid, options.previewPid].every(pid => Number.isSafeInteger(pid) && pid > 0)) {
    throw new Error('Retention requires explicit updater and preview ownership');
  }
  return { runtime, release, releases, commit, ledger: join(runtime, 'successful-releases.json'),
    lock: join(runtime, 'release-storage.lock') };
}
async function confirmedOwner(options, paths) {
  for (const path of [paths.runtime, paths.releases, paths.release, join(paths.runtime, 'data'), options.gridDirectory, options.jobsDirectory]) {
    await ordinaryPath(path, true);
  }
  const owner = await jsonFile(join(paths.runtime, 'updater.lock'));
  const status = await jsonFile(join(paths.runtime, 'status.json'));
  if (owner.repository !== repository || owner.pid !== options.ownerPid ||
      status.updaterPid !== options.ownerPid || status.previewPid !== options.previewPid ||
      status.activeCommit !== paths.commit || !samePath(status.releaseDirectory ?? '', paths.release) ||
      !confirmedStates.has(status.status) ||
      ![status.lastWorkingCommit, status.lastAttemptedCommit].every(value => value === null || commitPattern.test(value ?? ''))) {
    throw new Error('Retention ownership or promoted-release state changed');
  }
  return status;
}
async function readLedger(path) {
  const ledger = await jsonFile(path);
  if (ledger.schemaVersion !== 1 || ledger.repository !== repository || !Array.isArray(ledger.commits) ||
      ledger.commits.length > 512 || !ledger.commits.every(commit => typeof commit === 'string' && commitPattern.test(commit)) ||
      new Set(ledger.commits).size !== ledger.commits.length) {
    throw new Error('Retention requires verified successful-deployment history');
  }
  return ledger;
}
async function saveLedger(path, ledger) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
async function maintenanceLock(path) {
  const token = randomUUID();
  let file;
  try { file = await open(path, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await jsonFile(path);
    if (previous.kind !== lockKind || !Number.isSafeInteger(previous.pid) || previous.pid < 1) {
      throw new Error('Retention lock is not owned by this maintenance helper');
    }
    if (alive(previous.pid)) return null;
    await unlink(path);
    try { file = await open(path, 'wx'); }
    catch (retry) { if (retry.code === 'EEXIST') return null; throw retry; }
  }
  await file.writeFile(JSON.stringify({ kind: lockKind, pid: process.pid, token }));
  await file.close();
  return async () => {
    const owner = await jsonFile(path);
    if (owner.pid === process.pid && owner.token === token) await unlink(path);
  };
}
function protectedCommits(status, ledger, currentCommit) {
  const previous = ledger.commits.filter(commit => commit !== currentCommit).slice(-2);
  return new Set([currentCommit, status.activeCommit, status.lastWorkingCommit, status.lastAttemptedCommit, ...previous]);
}

/** Remove only reproducible dependencies; preserve public evidence and two verified rollback releases.
 * A failed ownership check returns an error instead of stopping the serving application.
 * Only a production preview confirmed by its existing updater can record a successful deployment.
 */
export async function maintainDemoReleaseStorage(options) {
  const result = { removed: [], skipped: [] };
  let releaseLock;
  try {
    const paths = pathsFor(options);
    await confirmedOwner(options, paths);
    releaseLock = await maintenanceLock(paths.lock);
    if (!releaseLock) { result.skipped.push('maintenance-already-running'); return result; }
    await confirmedOwner(options, paths);
    let ledger;
    try { ledger = await readLedger(paths.ledger); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ledger = { schemaVersion: 1, repository, commits: [] };
    }
    if (ledger.commits.at(-1) !== paths.commit) {
      ledger.commits = [...ledger.commits.filter(commit => commit !== paths.commit), paths.commit].slice(-128);
      await saveLedger(paths.ledger, ledger);
    }
    if (ledger.commits.length < 3) {
      result.skipped.push('awaiting-three-confirmed-releases');
      return result;
    }
    const entries = await readdir(paths.releases, { withFileTypes: true });
    for (const entry of entries) {
      if (result.removed.length >= 2) break;
      if (!commitPattern.test(entry.name)) continue;
      const status = await confirmedOwner(options, paths);
      const history = await readLedger(paths.ledger);
      if (protectedCommits(status, history, paths.commit).has(entry.name)) continue;
      const candidate = join(paths.releases, entry.name);
      const dependencies = join(candidate, 'node_modules'), markerPath = join(candidate, '.demo-built.json');
      try {
        await ordinaryPath(candidate, true);
        await ordinaryPath(dependencies, true);
        const marker = await jsonFile(markerPath);
        if (marker.commit !== entry.name) throw new Error('Build marker does not identify this release');
      } catch {
        result.skipped.push(entry.name);
        continue;
      }
      // The updater can publish a new candidate while filesystem checks are in progress.
      const latest = await confirmedOwner(options, paths);
      if (protectedCommits(latest, await readLedger(paths.ledger), paths.commit).has(entry.name)) continue;
      await unlink(markerPath); // Never leave a cached-build marker pointing at removed dependencies.
      await ordinaryPath(dependencies, true);
      await rm(dependencies, { recursive: true, force: false, maxRetries: 1, retryDelay: 50 });
      result.removed.push(entry.name);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Release retention could not be verified';
  } finally {
    if (releaseLock) {
      try { await releaseLock(); }
      catch { result.error ??= 'Release retention lock could not be released'; }
    }
  }
  return result;
}
