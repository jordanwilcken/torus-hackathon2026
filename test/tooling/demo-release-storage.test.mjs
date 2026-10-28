import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { maintainDemoReleaseStorage } from '../../scripts/deploy/demo-release-storage.mjs';

const repository = 'https://github.com/jordanwilcken/torus-hackathon2026.git';
const sha = digit => digit.repeat(40);
const old = sha('a'), previous2 = sha('b'), previous1 = sha('c'), active = sha('d'), candidate = sha('e');
async function present(path) { try { await access(path); return true; } catch { return false; } }
async function fixture(exercise) {
  const directory = await mkdtemp(join(tmpdir(), 'demo release retention '));
  const runtime = join(directory, 'runtime');
  const options = { runtimeDirectory: runtime, releaseDirectory: join(runtime, 'releases', active),
    ownerPid: process.pid, previewPid: process.pid, gridDirectory: join(runtime, 'data', 'grid'), jobsDirectory: join(runtime, 'data', 'jobs') };
  const status = { status: 'watching', updaterPid: process.pid, previewPid: process.pid,
    activeCommit: active, lastWorkingCommit: active, lastAttemptedCommit: candidate, releaseDirectory: options.releaseDirectory };
  async function saveStatus(value = status) { await writeFile(join(runtime, 'status.json'), JSON.stringify(value)); }
  async function release(commit, marker = { commit, builtAt: '2026-10-28T18:00:00.000Z' }) {
    const path = join(runtime, 'releases', commit);
    await mkdir(join(path, 'node_modules'), { recursive: true });
    await writeFile(join(path, 'node_modules', 'dependency.txt'), 'reproducible dependency');
    await writeFile(join(path, 'source.ts'), 'source remains');
    await mkdir(join(path, 'dist'));
    await writeFile(join(path, 'dist', 'index.html'), 'build remains');
    if (marker !== null) await writeFile(join(path, '.demo-built.json'), JSON.stringify(marker));
    return path;
  }
  try {
    await mkdir(options.gridDirectory, { recursive: true }); await mkdir(options.jobsDirectory, { recursive: true });
    await mkdir(join(runtime, 'logs')); await writeFile(join(runtime, 'logs', 'failure.log'), 'retain failed evidence');
    await writeFile(join(options.gridDirectory, 'capture.json'), 'retain capture');
    await writeFile(join(options.jobsDirectory, 'runs.sqlite'), 'retain receipt database');
    await writeFile(join(runtime, 'updater.lock'), JSON.stringify({ pid: process.pid, repository }));
    await writeFile(join(runtime, 'successful-releases.json'), JSON.stringify({ schemaVersion: 1, repository, commits: [old, previous2, previous1, active] }));
    for (const commit of [old, previous2, previous1, active, candidate]) await release(commit);
    await saveStatus();
    await exercise({ directory, runtime, options, status, saveStatus, release });
  } finally {
    const path = resolve(directory);
    assert.ok(path.startsWith(resolve(tmpdir()) + sep));
    assert.ok(path.includes('demo release retention '));
    await rm(path, { recursive: true, force: true });
  }
}

test('retention keeps current, in-flight and two previously promoted releases while preserving evidence', async () => {
  await fixture(async ({ runtime, options }) => {
    const result = await maintainDemoReleaseStorage(options);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.removed, [old]);
    for (const commit of [previous2, previous1, active, candidate]) {
      assert.equal(await present(join(runtime, 'releases', commit, 'node_modules', 'dependency.txt')), true);
      assert.equal(await present(join(runtime, 'releases', commit, '.demo-built.json')), true);
    }
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), false);
    assert.equal(await present(join(runtime, 'releases', old, '.demo-built.json')), false);
    assert.equal(await readFile(join(runtime, 'releases', old, 'source.ts'), 'utf8'), 'source remains');
    assert.equal(await readFile(join(runtime, 'releases', old, 'dist', 'index.html'), 'utf8'), 'build remains');
    assert.equal(await readFile(join(runtime, 'logs', 'failure.log'), 'utf8'), 'retain failed evidence');
    assert.equal(await readFile(join(options.gridDirectory, 'capture.json'), 'utf8'), 'retain capture');
    assert.equal(await readFile(join(options.jobsDirectory, 'runs.sqlite'), 'utf8'), 'retain receipt database');
  });
});

test('a preflight jobs directory is not allowed to perform production retention', async () => {
  await fixture(async ({ runtime, options }) => {
    const result = await maintainDemoReleaseStorage({ ...options, jobsDirectory: join(options.releaseDirectory, '.cache', 'preflight-jobs') });
    assert.ok(result.error);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});

test('an unrelated updater owner cannot delete release artifacts', async () => {
  await fixture(async ({ runtime, options }) => {
    await writeFile(join(runtime, 'updater.lock'), JSON.stringify({ pid: process.pid + 100, repository }));
    const result = await maintainDemoReleaseStorage(options);
    assert.ok(result.error);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});

test('a preview is not promoted merely because its build marker exists', async () => {
  await fixture(async ({ runtime, options, status, saveStatus }) => {
    await saveStatus({ ...status, previewPid: process.pid + 100 });
    const before = await readFile(join(runtime, 'successful-releases.json'), 'utf8');
    const result = await maintainDemoReleaseStorage(options);
    assert.ok(result.error);
    assert.equal(await readFile(join(runtime, 'successful-releases.json'), 'utf8'), before);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});

test('only the confirmed current release is appended to the successful-deployment ledger', async () => {
  await fixture(async ({ runtime, options }) => {
    await writeFile(join(runtime, 'successful-releases.json'), JSON.stringify({ schemaVersion: 1, repository, commits: [old, previous2, previous1] }));
    await maintainDemoReleaseStorage(options);
    const ledger = JSON.parse(await readFile(join(runtime, 'successful-releases.json'), 'utf8'));
    assert.deepEqual(ledger.commits, [old, previous2, previous1, active]);
    assert.equal(ledger.commits.includes(candidate), false);
  });
});

test('a missing or mismatched build marker never authorizes removal', async () => {
  await fixture(async ({ runtime, options }) => {
    await writeFile(join(runtime, 'releases', old, '.demo-built.json'), JSON.stringify({ commit: sha('f') }));
    const result = await maintainDemoReleaseStorage(options);
    assert.equal(result.removed.length, 0);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});

test('malformed deployment history fails closed instead of guessing rollback releases', async () => {
  await fixture(async ({ runtime, options }) => {
    await writeFile(join(runtime, 'successful-releases.json'), '{"schemaVersion":1,"commits":["not-a-commit"]}');
    const result = await maintainDemoReleaseStorage(options);
    assert.ok(result.error);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});

test('a symlink or junction dependency directory cannot escape the owned release', async () => {
  await fixture(async ({ directory, runtime, options }) => {
    const outside = join(directory, 'outside'), dependencies = join(runtime, 'releases', old, 'node_modules');
    await mkdir(outside); await writeFile(join(outside, 'important.txt'), 'outside preserved');
    await rm(dependencies, { recursive: true, force: true });
    await symlink(outside, dependencies, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await maintainDemoReleaseStorage(options);
    assert.equal(result.removed.length, 0);
    assert.equal(await readFile(join(outside, 'important.txt'), 'utf8'), 'outside preserved');
    assert.equal(await present(join(runtime, 'releases', old, '.demo-built.json')), true);
  });
});

test('an existing live maintenance owner prevents overlapping cleanup', async () => {
  await fixture(async ({ runtime, options }) => {
    await writeFile(join(runtime, 'release-storage.lock'), JSON.stringify({ kind: 'sunchaser-release-retention', pid: process.pid }));
    const result = await maintainDemoReleaseStorage(options);
    assert.equal(result.removed.length, 0);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});


test('each maintenance pass removes at most two inactive dependency trees', async () => {
  await fixture(async ({ runtime, options, release }) => {
    const more = [sha('0'), sha('1'), sha('2')];
    for (const commit of more) await release(commit);
    const first = await maintainDemoReleaseStorage(options);
    assert.equal(first.removed.length, 2);
    const retained = [];
    for (const commit of [old, ...more]) if (await present(join(runtime, 'releases', commit, 'node_modules'))) retained.push(commit);
    assert.equal(retained.length, 2);
    const second = await maintainDemoReleaseStorage(options);
    assert.equal(second.removed.length, 2);
    for (const commit of [previous2, previous1, active, candidate]) {
      assert.equal(await present(join(runtime, 'releases', commit, 'node_modules')), true);
    }
  });
});

test('an unfinished or previously failed build without a valid marker is preserved', async () => {
  await fixture(async ({ runtime, options }) => {
    await rm(join(runtime, 'releases', old, '.demo-built.json'));
    const result = await maintainDemoReleaseStorage(options);
    assert.deepEqual(result.removed, []);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});

test('a redirected release directory is rejected before its dependencies or build marker are changed', async () => {
  await fixture(async ({ directory, runtime, options }) => {
    const redirected = join(directory, 'external release');
    await mkdir(join(redirected, 'node_modules'), { recursive: true });
    await writeFile(join(redirected, 'node_modules', 'important.txt'), 'unowned dependency');
    await writeFile(join(redirected, '.demo-built.json'), JSON.stringify({ commit: old }));
    const releasePath = join(runtime, 'releases', old);
    assert.ok(resolve(releasePath).startsWith(resolve(runtime) + sep));
    await rm(releasePath, { recursive: true, force: true });
    await symlink(redirected, releasePath, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await maintainDemoReleaseStorage(options);
    assert.deepEqual(result.removed, []);
    assert.equal(await readFile(join(redirected, 'node_modules', 'important.txt'), 'utf8'), 'unowned dependency');
    assert.equal(await present(join(redirected, '.demo-built.json')), true);
  });
});

test('a separate last-working release remains protected even when it is outside the two newest rollback entries', async () => {
  await fixture(async ({ runtime, options, status, saveStatus }) => {
    await saveStatus({ ...status, lastWorkingCommit: old });
    const result = await maintainDemoReleaseStorage(options);
    assert.deepEqual(result.removed, []);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
  });
});



test('a new runtime bootstraps history but prunes nothing until three distinct promotions are confirmed', async () => {
  await fixture(async ({ runtime, options, status, saveStatus, release }) => {
    await rm(join(runtime, 'successful-releases.json'));
    const first = await maintainDemoReleaseStorage(options);
    assert.equal(first.error, undefined);
    assert.deepEqual(first.removed, []);
    assert.deepEqual(JSON.parse(await readFile(join(runtime, 'successful-releases.json'), 'utf8')).commits, [active]);
    const nextOptions = { ...options, releaseDirectory: join(runtime, 'releases', candidate) };
    await saveStatus({ ...status, activeCommit: candidate, lastWorkingCommit: candidate, lastAttemptedCommit: candidate, releaseDirectory: nextOptions.releaseDirectory });
    const second = await maintainDemoReleaseStorage(nextOptions);
    assert.deepEqual(second.removed, []);
    assert.equal(await present(join(runtime, 'releases', old, 'node_modules')), true);
    const thirdCommit = sha('f');
    const thirdDirectory = await release(thirdCommit);
    await saveStatus({ ...status, activeCommit: thirdCommit, lastWorkingCommit: thirdCommit, lastAttemptedCommit: thirdCommit, releaseDirectory: thirdDirectory });
    const third = await maintainDemoReleaseStorage({ ...options, releaseDirectory: thirdDirectory });
    assert.equal(third.removed.length, 2);
    for (const commit of [active, candidate, thirdCommit]) assert.equal(await present(join(runtime, 'releases', commit, 'node_modules')), true);
  });
});

