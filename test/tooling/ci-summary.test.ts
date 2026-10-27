import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { renderMarkdown } from '../../scripts/score-lib.mjs';

function report(earned = 35, allGreen = false) {
  const cases = [
    { id: 'FIRST', title: 'First requirement', group: 'Routing', points: 35,
      earned: earned >= 35 ? 35 : 0, classification: earned >= 35 ? 'passed' : 'unimplemented' },
    { id: 'SECOND', title: 'Second requirement', group: 'Bidding', points: 65,
      earned: earned === 100 ? 65 : 0, classification: earned === 100 ? 'passed' : 'unimplemented' },
  ];
  return {
    schemaVersion: 1, earned, maximum: 100, allGreen, validRun: true,
    commitSha: 'abc', runId: 'run-1', rubric: { version: '1', hash: 'hash' },
    cases, groups: cases.map(item => ({ group: item.group, earned: item.earned, maximum: item.points })),
    errors: [] as string[], humanReview: [],
  };
}

async function publish(value: unknown = report(), stages: Record<string, string> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'torus-ci-summary-'));
  try {
    await mkdir(path.join(directory, '.reports'));
    if (value !== null) await writeFile(path.join(directory, '.reports/score.json'),
      typeof value === 'string' ? value : JSON.stringify(value));
    const summaryFile = path.join(directory, 'summary.md');
    const outputsFile = path.join(directory, 'outputs');
    const env = { ...process.env, GITHUB_SHA: 'abc', GITHUB_STEP_SUMMARY: summaryFile, GITHUB_OUTPUT: outputsFile,
      INSTALL_RESULT: 'success', BUILD_RESULT: 'success', TOOLING_RESULT: 'success', BROWSER_RESULT: 'success',
      REQUIREMENTS_RESULT: 'failure', ...stages };
    const script = fileURLToPath(new URL('../../scripts/ci-summary.mjs', import.meta.url));
    const summary = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8', shell: false });
    const conclusion = spawnSync(process.execPath, [script, '--conclusion'], { cwd: directory, env, encoding: 'utf8', shell: false });
    return {
      summaryExit: summary.status, conclusionExit: conclusion.status,
      text: await readFile(summaryFile, 'utf8'),
      outputs: await readFile(outputsFile, 'utf8').catch(() => ''),
      log: summary.stdout + summary.stderr,
    };
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(target).startsWith('torus-ci-summary-'));
    await rm(target, { recursive: true, force: true });
  }
}

test('a valid partial score is visible in Actions while unfinished requirements are advisory', async () => {
  const result = await publish();
  assert.equal(result.summaryExit, 0, result.log);
  assert.equal(result.conclusionExit, 0);
  assert.match(result.text, /35\/100/);
  assert.match(result.text, /1\/2 requirements passed/);
  assert.match(result.text, /RED/);
  assert.match(result.outputs, /score_label=35\/100 - 1\/2 requirements passed \(advisory\)/);
  assert.match(result.log, /35\/100/);
});

test('a valid zero stays zero rather than becoming unavailable', async () => {
  const result = await publish(report(0));
  assert.equal(result.conclusionExit, 0);
  assert.match(result.outputs, /score_label=0\/100/);
  assert.doesNotMatch(result.text, /Score unavailable/);
});

test('missing, malformed, stale and invalid evidence never publish a numeric score', async () => {
  for (const value of [null, '{invalid json', { ...report(), commitSha: 'old' },
    { ...report(), validRun: false }, { ...report(), earned: 99 }, { ...report(), allGreen: true },
    { ...report(), groups: [{ group: 'Broken', earned: 35, maximum: 0 }] },
    { ...report(), cases: [{ ...report().cases[0], title: undefined }, report().cases[1]] }]) {
    const result = await publish(value);
    assert.equal(result.summaryExit, 0, result.log);
    assert.equal(result.conclusionExit, 1);
    assert.match(result.text, /Score unavailable/);
    assert.match(result.outputs, /score_label=unavailable/);
    assert.doesNotMatch(result.outputs, /score_label=\d/);
  }
});

test('the summary links directly to the downloadable scorecard and exact rubric', async () => {
  const url = 'https://github.com/example/project/actions/runs/123/artifacts/456';
  const result = await publish(report(), { SCORE_ARTIFACT_URL: url });
  assert.ok(result.text.includes(`[Download scorecard and rubric](${url})`));
});

test('a build or reporting-tool failure stays a CI failure even with scored evidence', async () => {
  for (const stage of ['INSTALL_RESULT', 'BUILD_RESULT', 'TOOLING_RESULT', 'BROWSER_RESULT']) {
    const result = await publish(report(), { [stage]: 'failure' });
    assert.equal(result.conclusionExit, 1);
    assert.match(result.text, /CI needs attention/);
  }
});

test('a skipped requirement runner cannot be reported as a healthy CI run', async () => {
  const result = await publish(report(), { REQUIREMENTS_RESULT: 'skipped' });
  assert.equal(result.conclusionExit, 1);
});

test('all scored and unscored tests passing is reported as all tests green', async () => {
  const result = await publish(report(100, true), { REQUIREMENTS_RESULT: 'success' });
  assert.equal(result.conclusionExit, 0);
  assert.match(result.text, /all tests green/);
  assert.match(result.outputs, /score_label=100\/100 - all tests green/);
});

test('full rubric points do not hide a failing unscored test', async () => {
  const result = await publish(report(100, false));
  assert.equal(result.conclusionExit, 0);
  assert.match(result.text, /other tests remain RED/);
  assert.doesNotMatch(result.outputs, /all tests green/);
});

test('the scorecard shows total and area progress without rounding up points', () => {
  const text = renderMarkdown(report());
  assert.match(text, /35\/100/);
  assert.match(text, /1\/2 requirements passed/);
  assert.match(text, /Routing.*35.*35.*█/);
  assert.match(text, /Bidding.*0.*65.*░/);
  assert.match(text, /unimplemented/);
});

test('a report with harness failures clearly marks its total unavailable', () => {
  const text = renderMarkdown({ ...report(0), validRun: false, errors: ['Runner did not start.'] });
  assert.match(text, /Score unavailable/);
  assert.doesNotMatch(text, /\*\*0\/100\*\*/);
  assert.match(text, /Runner did not start/);
});
