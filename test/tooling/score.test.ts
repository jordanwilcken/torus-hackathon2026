import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fingerprintInputs, renderMarkdown, scoreReports, validateRubric, verifyRecordedRun } from '../../scripts/score-lib.mjs';
import ScoreVitestReporter from '../../scripts/score-vitest-reporter.mjs';

const root = path.resolve('/score-project');
const metadata = {
  runId: 'current-run', projectRoot: root, commitSha: 'abc', rubricHash: 'rubric-hash', inputHash: 'inputs-hash',
  completedAt: '2026-10-27T12:00:00Z', runners: { vitest: { reportHash: 'v' }, playwright: { reportHash: 'p' } },
};
const rubric = (runner: 'vitest' | 'playwright' = 'vitest') => ({
  id: 'test-only', version: '1', description: 'Internal test rubric', humanReview: [],
  cases: [{ id: 'A', group: 'Example', points: 100, runner,
    file: runner === 'vitest' ? 'test/core/example/example.test.ts' : 'test/userflows/scheduling/scheduling.test.ts',
    project: runner === 'vitest' ? '' : 'chromium', title: 'does useful work' }],
});
const vitestReport = (results: ReturnType<typeof assertion>[] = []) => ({ success: true, testResults: [{
  name: path.join(root, 'test/core/example/example.test.ts'), status: 'passed', assertionResults: results,
}] });
const assertion = (status = 'passed', failureMessages: string[] = []) => ({
  title: 'does useful work', status, failureMessages,
  meta: { scoreAudit: { version: 1, project: '', expectedFailure: false, retryCount: 0, repeatCount: 0,
    runErrors: [] as string[], interrupted: false } },
});
const playwrightReport = (expectedStatus = 'passed', results = [{ status: 'passed', retry: 0 }]) => ({
  config: { rootDir: path.join(root, 'test/userflows') }, errors: [], stats: { unexpected: 0 }, suites: [{
    title: 'scheduling.test.ts', file: 'scheduling/scheduling.test.ts', specs: [{ title: 'does useful work', file: 'scheduling/scheduling.test.ts', ok: true,
      tests: [{ projectName: 'chromium', expectedStatus, status: 'expected', results }],
    }],
  }],
});
const inputs = (v = vitestReport(), p = playwrightReport()) => ({
  vitest: { report: v, exitCode: 0 }, playwright: { report: p, exitCode: 0 },
});

test('only a genuine single passed result earns its authored points', () => {
  const report = scoreReports(rubric(), inputs(vitestReport([assertion()])), metadata);
  assert.equal(report.earned, 100);
  assert.equal(report.cases[0].classification, 'passed');
  assert.equal(report.maximum, 100);
  assert.equal(report.allGreen, true);
});

test('Vitest expected failures do not earn points from a passed JSON status', () => {
  const result = assertion();
  result.meta.scoreAudit.expectedFailure = true;
  const report = scoreReports(rubric(), inputs(vitestReport([result])), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'failed');
  assert.equal(report.cases[0].raw[0].audit.expectedFailure, true);
});

test('a Vitest retry that eventually passes is a harness error', () => {
  const result = assertion();
  result.meta.scoreAudit.retryCount = 1;
  const report = scoreReports(rubric(), inputs(vitestReport([result])), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'harness-error');
});

test('Vitest JSON without the runner audit fails closed', () => {
  const result = assertion();
  Reflect.deleteProperty(result.meta, 'scoreAudit');
  const report = scoreReports(rubric(), inputs(vitestReport([result])), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'harness-error');
});

test('the Vitest reporter records actual project, expected-failure and retry diagnostics', () => {
  const observed: Record<string, unknown> = {};
  const testCase = {
    project: { name: 'named-project' }, options: { fails: true },
    diagnostic: () => ({ retryCount: 2, repeatCount: 1 }), meta: () => observed,
  };
  new ScoreVitestReporter().onTestRunEnd([{ children: { allTests: () => [testCase] } }], [], 'passed');
  assert.deepEqual(observed.scoreAudit, {
    version: 1, project: 'named-project', expectedFailure: true, retryCount: 2, repeatCount: 1,
    runErrors: [], interrupted: false,
  });
});

test('unhandled Vitest errors invalidate otherwise passed results', () => {
  const result = assertion();
  new ScoreVitestReporter().onTestRunEnd([{ children: { allTests: () => [{
    project: { name: '' }, options: { fails: false },
    diagnostic: () => ({ retryCount: 0, repeatCount: 0 }), meta: () => result.meta,
  }] } }], [{ message: 'unhandled rejection' }], 'failed');
  const report = scoreReports(rubric(), inputs(vitestReport([result])), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'harness-error');
  assert.deepEqual(report.cases[0].raw[0].audit.runErrors, ['unhandled rejection']);
});

test('a suite hook failure invalidates otherwise passed assertions', () => {
  const results = vitestReport([assertion()]);
  results.testResults[0].status = 'failed';
  const report = scoreReports(rubric(), inputs(results), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'harness-error');
});

test('an expected Playwright failure earns zero even when spec.ok is true', () => {
  const report = scoreReports(rubric('playwright'), inputs(vitestReport(), playwrightReport('failed', [{ status: 'failed', retry: 0 }])), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'failed');
  assert.equal(report.cases[0].raw[0].specOk, true);
});

test('an unexpected pass under an expected-failure annotation earns zero', () => {
  const report = scoreReports(rubric('playwright'), inputs(vitestReport(), playwrightReport('failed')), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'failed');
});

test('a retry that eventually passes is a harness error and earns zero', () => {
  const report = scoreReports(rubric('playwright'), inputs(vitestReport(), playwrightReport('passed', [
    { status: 'failed', retry: 0 }, { status: 'passed', retry: 1 },
  ])), metadata);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'harness-error');
});

test('duplicate exact runner/file/title/project matches are rejected', () => {
  const report = scoreReports(rubric(), inputs(vitestReport([assertion(), assertion()])), metadata);
  assert.equal(report.cases[0].classification, 'harness-error');
  assert.equal(report.earned, 0);
  assert.equal(report.validRun, false);
});

test('a missing case retains its full denominator and is not-run', () => {
  const report = scoreReports(rubric(), inputs(), metadata);
  assert.equal(report.cases[0].classification, 'not-run');
  assert.equal(report.earned, 0);
  assert.equal(report.maximum, 100);
});

test('wrong file or project cannot satisfy a required case with the same title', () => {
  const wrongFile = vitestReport([assertion()]);
  wrongFile.testResults[0].name = path.join(root, 'other.test.ts');
  assert.equal(scoreReports(rubric(), inputs(wrongFile), metadata).earned, 0);
  const wrongProject = playwrightReport();
  wrongProject.suites[0].specs[0].tests[0].projectName = 'firefox';
  assert.equal(scoreReports(rubric('playwright'), inputs(vitestReport(), wrongProject), metadata).earned, 0);
});

test('known unimplemented drivers stay RED with their raw failure preserved', () => {
  const actual = inputs(vitestReport([assertion('failed', ['Error: Not implemented: submitJob'])]));
  actual.vitest.exitCode = 1;
  const report = scoreReports(rubric(), actual, metadata);
  assert.equal(report.cases[0].classification, 'unimplemented');
  assert.equal(report.earned, 0);
  assert.match(report.cases[0].raw[0].messages[0], /Not implemented/);
});

const liveRequirement = {
  id: 'LIVE-01', runner: 'playwright', file: 'test/userflows/scheduling/scheduling.test.ts',
  project: 'chromium', title: 'does useful work',
  description: 'Current public inputs drive a real worker; the storage comparison remains modeled.',
};

test('an unfinished business requirement is individually visible without changing the 100-point score', () => {
  const publicInputRun = playwrightReport('passed', [{ status: 'failed', retry: 0 }]);
  Object.assign(publicInputRun.suites[0].specs[0].tests[0].results[0], {
    error: { message: 'Unimplemented: bind the real worker output to this acceptance driver.' },
  });
  const actual = inputs(vitestReport([assertion()]), publicInputRun);
  actual.playwright.exitCode = 1;
  const report = scoreReports({ ...rubric(), nonScoredRequirements: [liveRequirement] }, actual, metadata);

  assert.equal(report.earned, 100);
  assert.equal(report.maximum, 100);
  assert.equal(report.cases.length, 1);
  assert.equal(report.nonScoredRequirements[0].classification, 'unimplemented');
  assert.match(report.nonScoredRequirements[0].raw[0].messages[0], /real worker/);
  assert.equal(report.allGreen, false);
  assert.equal(report.validRun, true);
  assert.match(renderMarkdown(report), /Business requirements \(not scored\)/);
  assert.match(renderMarkdown(report), /LIVE-01.*unimplemented/);
  assert.match(renderMarkdown(report), /100\/100/);
});

test('missing or skipped business requirements cannot become all tests green', () => {
  const missing = scoreReports({ ...rubric(), nonScoredRequirements: [{ ...liveRequirement, title: 'missing result' }] },
    inputs(vitestReport([assertion()])), metadata);
  assert.equal(missing.nonScoredRequirements[0].classification, 'not-run');
  assert.equal(missing.allGreen, false);
  assert.equal(missing.maximum, 100);

  const skipped = scoreReports({ ...rubric(), nonScoredRequirements: [liveRequirement] },
    inputs(vitestReport([assertion()]), playwrightReport('skipped', [{ status: 'skipped', retry: 0 }])), metadata);
  assert.equal(skipped.nonScoredRequirements[0].classification, 'skipped');
  assert.equal(skipped.allGreen, false);
});

test('a genuine business requirement pass contributes no points and allows all tests green', () => {
  const report = scoreReports({ ...rubric(), nonScoredRequirements: [liveRequirement] },
    inputs(vitestReport([assertion()])), metadata);
  assert.equal(report.nonScoredRequirements[0].classification, 'passed');
  assert.equal(report.earned, 100);
  assert.equal(report.maximum, 100);
  assert.equal(report.allGreen, true);
});

test('duplicate business results invalidate the run instead of being hidden outside the points', () => {
  const browser = playwrightReport();
  browser.suites[0].specs.push(structuredClone(browser.suites[0].specs[0]));
  const report = scoreReports({ ...rubric(), nonScoredRequirements: [liveRequirement] },
    inputs(vitestReport([assertion()]), browser), metadata);
  assert.equal(report.nonScoredRequirements[0].classification, 'harness-error');
  assert.equal(report.validRun, false);
  assert.equal(report.allGreen, false);
  assert.ok(report.errors.some(error => error.includes('LIVE-01')));
});

test('non-scored requirements cannot add weights or reuse a scored identity', () => {
  assert.throws(() => validateRubric({ ...rubric(), nonScoredRequirements: [{ ...liveRequirement, points: 5 }] }), /non-scored|Invalid/i);
  assert.throws(() => validateRubric({ ...rubric(), nonScoredRequirements: [{ ...liveRequirement, id: 'A' }] }), /duplicate/i);
  assert.throws(() => validateRubric({ ...rubric('playwright'), nonScoredRequirements: [liveRequirement] }), /duplicate/i);
});

test('skipped work earns no points', () => {
  const report = scoreReports(rubric(), inputs(vitestReport([assertion('pending')])), metadata);
  assert.equal(report.cases[0].classification, 'skipped');
  assert.equal(report.earned, 0);
});

test('invalid startup output is a harness error, not a passed or unimplemented test', () => {
  const report = scoreReports(rubric(), { ...inputs(), vitest: { exitCode: 1, report: { malformed: true } } }, metadata);
  assert.equal(report.cases[0].classification, 'harness-error');
  assert.equal(report.validRun, false);
  assert.equal(report.earned, 0);
});

test('a previous run or changed input/report cannot be reused by report-only', () => {
  assert.deepEqual(verifyRecordedRun(metadata, metadata, { vitest: 'v', playwright: 'p' }), []);
  const stale = verifyRecordedRun(metadata, { ...metadata, runId: 'new-run', inputHash: 'changed' }, { vitest: 'old-v', playwright: 'p' });
  assert.ok(stale.some(error => error.includes('runId')));
  assert.ok(stale.some(error => error.includes('inputHash')));
  assert.ok(stale.some(error => error.includes('vitest')));
  const report = scoreReports(rubric(), inputs(vitestReport([assertion()])), metadata, stale);
  assert.equal(report.earned, 0);
  assert.equal(report.cases[0].classification, 'harness-error');
  assert.deepEqual(verifyRecordedRun({ ...metadata, verificationErrors: ['Inputs changed during the run.'] }, metadata,
    { vitest: 'v', playwright: 'p' }), ['Inputs changed during the run.']);
});

test('the Vite HTML entrypoint participates in the run fingerprint', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'torus-score-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<main>first</main>');
    const before = await fingerprintInputs(directory);
    await writeFile(path.join(directory, 'index.html'), '<main>changed</main>');
    assert.notEqual(await fingerprintInputs(directory), before);
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(target).startsWith('torus-score-'));
    await rm(target, { recursive: true, force: true });
  }
});

test('duplicate rubric identities and changed denominators are invalid', () => {
  const duplicate = rubric();
  duplicate.cases.push({ ...duplicate.cases[0] });
  assert.throws(() => validateRubric(duplicate), /duplicate/);
  const smaller = rubric();
  smaller.cases[0].points = 90;
  assert.throws(() => validateRubric(smaller), /100/);
});

test('the CLI always writes a score when test runners fail to start', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'torus-score-'));
  try {
    await writeFile(path.join(directory, 'rubric.json'), JSON.stringify(rubric()));
    const cli = fileURLToPath(new URL('../../scripts/score.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli], { cwd: directory, encoding: 'utf8', shell: false });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(await readFile(path.join(directory, '.reports/score.json'), 'utf8'));
    assert.equal(report.earned, 0);
    assert.equal(report.maximum, 100);
    assert.equal(report.cases[0].classification, 'harness-error');
    assert.match(await readFile(path.join(directory, '.reports/score.md'), 'utf8'), /0\/100/);
    const replay = spawnSync(process.execPath, [cli, '--report-only'], { cwd: directory, encoding: 'utf8', shell: false });
    assert.equal(replay.status, 1);
    const rejected = JSON.parse(await readFile(path.join(directory, '.reports/score.json'), 'utf8'));
    assert.equal(rejected.validRun, false);
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(target).startsWith('torus-score-'));
    await rm(target, { recursive: true, force: true });
  }
});
