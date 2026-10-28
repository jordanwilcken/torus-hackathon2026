import assert from 'node:assert/strict';
import test from 'node:test';
import { createReleaseUpdater } from '../../scripts/deploy/demo-updater.mjs';

const oldCommit = 'a'.repeat(40), newCommit = 'b'.repeat(40);
function deployment(overrides = {}) {
  const events = [];
  const actions = {
    async prepare(commit) { events.push(`build:${commit}`); return { commit, directory: `/release/${commit}` }; },
    async preflight(release) { events.push(`preflight:${release.commit}`); },
    async awaitIdle(release) { events.push(`idle:${release.commit}`); },
    async stop(release) { events.push(`stop:${release.commit}`); },
    async start(release) { events.push(`start:${release.commit}`); return release; },
    async report(state) { events.push(`report:${state.status}:${state.activeCommit}`); },
    ...overrides,
  };
  const current = { commit: oldCommit, directory: `/release/${oldCommit}` };
  return { updater: createReleaseUpdater(actions, current), events, current };
}

test('a new release is built and preflighted before the serving worker is stopped', async () => {
  const { updater, events } = deployment();
  const result = await updater.update(newCommit);
  assert.equal(result.activeCommit, newCommit);
  const operations = events.filter(item => !item.startsWith('report:'));
  assert.deepEqual(operations, [`build:${newCommit}`, `preflight:${newCommit}`, `idle:${oldCommit}`, `stop:${oldCommit}`, `start:${newCommit}`]);
});

test('a failed build leaves the current deployment running and records the failed candidate', async () => {
  const { updater, events, current } = deployment({ async prepare() { throw new Error('Build failed'); } });
  const result = await updater.update(newCommit);
  assert.equal(updater.active, current);
  assert.equal(result.activeCommit, oldCommit);
  assert.equal(result.updateFailed, true);
  assert.equal(events.some(event => event.startsWith('stop:')), false);
  assert.equal(events.some(event => event.startsWith('start:')), false);
});

test('a failed preflight leaves the current deployment running', async () => {
  const { updater, events, current } = deployment({ async preflight() { throw new Error('Missing API'); } });
  const result = await updater.update(newCommit);
  assert.equal(updater.active, current);
  assert.equal(result.updateFailed, true);
  assert.equal(events.some(event => event.startsWith('stop:')), false);
});

test('a failed production start restores the previous release and never advertises the candidate', async () => {
  const started = [], reports = [];
  const { updater } = deployment({
    async start(release) { started.push(release.commit); if (release.commit === newCommit) throw new Error('Production health failed'); return release; },
    async report(state) { reports.push({ ...state }); },
  });
  const result = await updater.update(newCommit);
  assert.deepEqual(started, [newCommit, oldCommit]);
  assert.equal(updater.active.commit, oldCommit);
  assert.equal(result.updateFailed, true);
  assert.equal(reports.some(report => report.activeCommit === newCommit), false);
});

test('the same active commit does not rebuild or interrupt the server', async () => {
  const { updater, events } = deployment();
  const result = await updater.update(oldCommit);
  assert.equal(result.changed, false);
  assert.deepEqual(events, []);
});

test('overlapping polls cannot build or switch two versions concurrently', async () => {
  let finishBuild;
  const building = new Promise(resolve => { finishBuild = resolve; });
  let builds = 0;
  const { updater } = deployment({ async prepare(commit) { builds += 1; await building; return { commit }; } });
  const first = updater.update(newCommit);
  const second = updater.update(newCommit);
  finishBuild();
  await Promise.all([first, second]);
  assert.equal(builds, 1);
});

test('an unchanged failed build is not retried every poll; a newer main commit is attempted', async () => {
  let builds = 0;
  const nextCommit = 'c'.repeat(40);
  const { updater } = deployment({ async prepare(commit) { builds += 1; if (commit === newCommit) throw new Error('Build failed'); return { commit }; } });
  await updater.update(newCommit);
  const repeat = await updater.update(newCommit);
  assert.equal(repeat.changed, false);
  assert.equal(builds, 1);
  await updater.update(nextCommit);
  assert.equal(builds, 2);
  assert.equal(updater.active.commit, nextCommit);
});

test('an owned server can recover its last working release without rebuilding main', async () => {
  const { updater, events } = deployment();
  const recovered = await updater.recover();
  assert.equal(recovered, true);
  assert.equal(updater.active.commit, oldCommit);
  assert.deepEqual(events.filter(event => !event.startsWith('report:')), ['start:' + oldCommit]);
});

test('a failed recovery stays explicit and a later recovery retries the saved release', async () => {
  let attempts = 0;
  const { updater } = deployment({
    async start(release) { attempts += 1; if (attempts === 1) throw new Error('Temporarily unavailable'); return release; },
  });
  assert.equal(await updater.recover(), false);
  assert.equal(updater.active, null);
  assert.equal(updater.snapshot().lastWorkingCommit, oldCommit);
  assert.equal(await updater.recover(), true);
  assert.equal(updater.active.commit, oldCommit);
});

test('build commands do not receive server keys or unrelated deployment credentials', async () => {
  const { buildEnvironment } = await import('../../scripts/deploy/demo-updater.mjs');
  const environment = buildEnvironment('/tools/npm-cli.js', '/demo/cache', {
    PATH: '/tools', SystemRoot: 'C:/Windows', EIA_API_KEY: 'test-only-secret', CLOUDFLARE_API_TOKEN: 'test-only-token',
  });
  assert.equal(environment.EIA_API_KEY, undefined);
  assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(environment.SystemRoot, 'C:/Windows');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
});

async function withPreview(replies, exercise) {
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => {
    const reply = replies[request.url] ?? [404, 'text/plain', 'missing'];
    response.writeHead(reply[0], { 'Content-Type': reply[1] });
    response.end(typeof reply[2] === 'string' ? reply[2] : JSON.stringify(reply[2]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await exercise('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function healthyPreview() {
  return {
    '/': [200, 'text/html', '<script type="module" src="/assets/app.js"></script>'],
    '/assets/app.js': [200, 'text/javascript', 'export const built = true;'],
    '/api/jobs/context': [200, 'application/json', { mode: 'live', busy: false, inputs: { eia: { status: 'ready' }, caiso: { status: 'ready' } } }],
    '/api/weather/sites': [200, 'application/json', { status: 'ready', snapshot: {} }],
  };
}

test('preflight reads built JavaScript and both actual API shapes', async () => {
  const { checkPreview } = await import('../../scripts/deploy/demo-updater.mjs');
  await withPreview(healthyPreview(), base => checkPreview(base));
});

test('a static-only landing page cannot pass preflight when API URLs return HTML', async () => {
  const { checkPreview } = await import('../../scripts/deploy/demo-updater.mjs');
  const replies = healthyPreview();
  replies['/api/jobs/context'] = [200, 'text/html', '<html>Static fallback</html>'];
  await withPreview(replies, base => assert.rejects(checkPreview(base)));
});

test('a missing compiled asset fails preflight even if the index HTML exists', async () => {
  const { checkPreview } = await import('../../scripts/deploy/demo-updater.mjs');
  const replies = healthyPreview();
  delete replies['/assets/app.js'];
  await withPreview(replies, base => assert.rejects(checkPreview(base), /assets/));
});

test('a reported source outage is retained as an outage rather than blocking a healthy release', async () => {
  const { checkPreview } = await import('../../scripts/deploy/demo-updater.mjs');
  const replies = healthyPreview();
  replies['/api/weather/sites'] = [200, 'application/json', { status: 'unavailable', snapshot: null }];
  replies['/api/jobs/context'][2].inputs.eia.status = 'unavailable';
  await withPreview(replies, base => checkPreview(base));
});



test('nested npm and npx resolve the pinned CLI through runtime launchers, including paths with spaces', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve, sep } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { buildEnvironment, createPackageManagerLaunchers } = await import('../../scripts/deploy/demo-updater.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'demo npm launchers '));
  try {
    const source = join(directory, 'unpacked package', 'bin'), launchers = join(directory, 'owned runtime bin');
    await mkdir(source, { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    const cli = join(source, 'npm-cli.js');
    await writeFile(cli, 'import { execSync } from "node:child_process";\n' +
      'if (process.argv[2] === "outer") { process.stdout.write(execSync("npm --nested", { env: process.env })); process.stdout.write(execSync("npx --nested", { env: process.env })); }\n' +
      'else if (process.argv[2] === "--nested") process.stdout.write("pinned npm\\n");\n' +
      'else process.exit(1);\n');
    await writeFile(join(source, 'npx-cli.js'), 'process.stdout.write("pinned npx\\n");\n');
    await createPackageManagerLaunchers(launchers, cli);
    const output = execFileSync(process.execPath, [cli, 'outer'], {
      cwd: directory, windowsHide: true, encoding: 'utf8',
      env: buildEnvironment(cli, join(directory, 'cache'), process.env, launchers),
    });
    assert.equal(output.replaceAll('\r', ''), 'pinned npm\npinned npx\n');
  } finally {
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
    assert.ok(absolute.includes('demo npm launchers '));
    await rm(absolute, { recursive: true, force: true });
  }
});

