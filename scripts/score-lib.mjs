import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const unimplemented = text => /NotImplemented|not[\s_-]+implemented|unimplemented/i.test(text);
const key = item => JSON.stringify([item.runner, item.file, item.project, item.title]);
const normalized = value => path.resolve(value).replaceAll('\\', '/');

export function validateRubric(rubric) {
  if (!rubric?.id || !rubric.version || !Array.isArray(rubric.cases) || !rubric.cases.length) {
    throw new Error('Rubric must have an ID, version and nonempty cases.');
  }
  const ids = new Set();
  const matches = new Set();
  for (const item of rubric.cases) {
    if (!item.id || !item.group || !['vitest', 'playwright'].includes(item.runner)
      || !item.file || typeof item.project !== 'string' || !item.title
      || !Number.isFinite(item.points) || item.points <= 0 || ids.has(item.id) || matches.has(key(item))) {
      throw new Error(`Invalid or duplicate rubric case: ${item.id ?? '(missing ID)'}`);
    }
    ids.add(item.id);
    matches.add(key(item));
  }
  if (rubric.cases.reduce((sum, item) => sum + item.points, 0) !== 100) {
    throw new Error('The internal rubric denominator must remain 100.');
  }
  if (rubric.nonScoredRequirements !== undefined && !Array.isArray(rubric.nonScoredRequirements)) {
    throw new Error('Non-scored requirements must be an array.');
  }
  for (const item of rubric.nonScoredRequirements ?? []) {
    if (!item.id || !['vitest', 'playwright'].includes(item.runner)
      || !item.file || typeof item.project !== 'string' || !item.title
      || 'points' in item || ids.has(item.id) || matches.has(key(item))) {
      throw new Error(`Invalid or duplicate non-scored requirement: ${item.id ?? '(missing ID)'}`);
    }
    ids.add(item.id);
    matches.add(key(item));
  }
}

function relativeFile(file, base, root) {
  if (typeof file !== 'string' || !file) throw new Error('A runner result has no file identity.');
  return path.relative(root, path.resolve(base, file)).replaceAll('\\', '/');
}

function classifyFailure(messages) {
  return unimplemented(messages.join('\n')) ? 'unimplemented' : 'failed';
}

function vitestRecords(report, root) {
  if (!Array.isArray(report?.testResults) || typeof report.success !== 'boolean') {
    throw new Error('Invalid Vitest JSON report.');
  }
  if (report.numRuntimeErrorTestSuites > 0 || report.unhandledErrors?.length) {
    throw new Error('Vitest reported a runner/runtime error.');
  }
  return report.testResults.flatMap(suite => {
    if (!Array.isArray(suite.assertionResults)) throw new Error('Invalid Vitest suite.');
    if (suite.status === 'failed' && !suite.assertionResults.some(result => result.status === 'failed')) {
      throw new Error('Vitest suite failed outside an individual test.');
    }
    return suite.assertionResults.map(result => {
      const messages = (result.failureMessages ?? []).map(String);
      const audit = result.meta?.scoreAudit;
      let classification = result.status === 'passed' ? 'passed'
        : ['skipped', 'pending', 'todo', 'disabled'].includes(result.status) ? 'skipped'
          : result.status === 'failed' ? classifyFailure(messages) : 'not-run';
      const validCount = count => count === null || (Number.isInteger(count) && count >= 0);
      const validAudit = audit?.version === 1 && typeof audit.project === 'string'
        && typeof audit.expectedFailure === 'boolean'
        && validCount(audit.retryCount) && validCount(audit.repeatCount)
        && Array.isArray(audit.runErrors) && typeof audit.interrupted === 'boolean';
      if (!validAudit || audit.runErrors.length || audit.interrupted || audit.retryCount > 0 || audit.repeatCount > 0
        || (result.status === 'passed' && (audit.retryCount !== 0 || audit.repeatCount !== 0))) {
        classification = 'harness-error';
      } else if (audit.expectedFailure && classification === 'passed') {
        classification = 'failed';
      }
      return {
        runner: 'vitest', file: relativeFile(suite.name, root, root),
        project: audit?.project ?? suite.projectName ?? result.projectName ?? '', title: result.title,
        classification,
        raw: { status: result.status, audit: audit ?? null, messages },
      };
    });
  });
}

function playwrightRecords(report, root) {
  if (!Array.isArray(report?.suites) || !report.config || !Array.isArray(report.errors) || !report.stats) {
    throw new Error('Invalid Playwright JSON report.');
  }
  if (report.errors.length) throw new Error('Playwright reported a global runner error.');
  const records = [];
  function visit(suites) {
    for (const suite of suites) {
      if (!Array.isArray(suite.specs)) throw new Error('Invalid Playwright suite.');
      for (const spec of suite.specs) {
        if (!Array.isArray(spec.tests)) throw new Error('Invalid Playwright spec.');
        for (const test of spec.tests) {
          if (!Array.isArray(test.results)) throw new Error('Invalid Playwright test results.');
          const results = test.results;
          const messages = results.flatMap(result => [result.error?.message, ...(result.errors ?? []).map(error => error.message)]).filter(Boolean);
          const actual = results[0]?.status;
          let classification = actual === 'skipped' || test.expectedStatus === 'skipped' ? 'skipped'
            : !results.length ? 'not-run'
              : actual === 'passed' && test.expectedStatus === 'passed' ? 'passed' : classifyFailure(messages);
          if (results.length > 1 || results.some(result => result.retry !== 0)) classification = 'harness-error';
          records.push({
            runner: 'playwright', file: relativeFile(spec.file, report.config.rootDir ?? root, root),
            project: test.projectName, title: spec.title, classification,
            raw: { expectedStatus: test.expectedStatus, status: test.status, specOk: spec.ok,
              resultStatuses: results.map(result => result.status), retries: results.map(result => result.retry), messages },
          });
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  return records;
}

export function scoreReports(rubric, inputs, metadata, verificationErrors = []) {
  validateRubric(rubric);
  const records = [];
  const errors = [...verificationErrors];
  const runnerErrors = {};
  for (const runner of ['vitest', 'playwright']) {
    try {
      const input = inputs[runner];
      if (verificationErrors.length) throw new Error('Recorded run could not be verified.');
      if (!input || input.error || ![0, 1].includes(input.exitCode) || input.signal) {
        throw new Error(input?.error ?? 'Runner did not produce a usable result.');
      }
      const found = runner === 'vitest' ? vitestRecords(input.report, metadata.projectRoot)
        : playwrightRecords(input.report, metadata.projectRoot);
      records.push(...found);
    } catch (error) {
      runnerErrors[runner] = error.message;
      errors.push(`${runner}: ${error.message}`);
    }
  }
  const resultFor = item => {
    const matches = records.filter(record => key(record) === key(item));
    const classification = runnerErrors[item.runner] ? 'harness-error'
      : matches.length > 1 ? 'harness-error' : matches[0]?.classification ?? 'not-run';
    return { ...item, classification,
      detail: runnerErrors[item.runner] ?? (matches.length > 1 ? 'Duplicate exact test identity.' : !matches.length ? 'Expected test result missing.' : ''),
      raw: matches.map(record => record.raw) };
  };
  const cases = rubric.cases.map(item => {
    const result = resultFor(item);
    return { ...result, earned: result.classification === 'passed' ? item.points : 0 };
  });
  const nonScoredRequirements = (rubric.nonScoredRequirements ?? []).map(resultFor);
  for (const item of [...cases, ...nonScoredRequirements]) {
    if (item.classification === 'harness-error' && !runnerErrors[item.runner]) {
      item.detail ||= 'Missing audit, retries, repeats or malformed results cannot establish one genuine pass.';
      errors.push(`${item.id}: ${item.detail}`);
    }
  }
  const groups = [...new Set(cases.map(item => item.group))].map(group => ({
    group, earned: cases.filter(item => item.group === group).reduce((sum, item) => sum + item.earned, 0),
    maximum: cases.filter(item => item.group === group).reduce((sum, item) => sum + item.points, 0),
  }));
  return {
    schemaVersion: 1, rubric: { id: rubric.id, version: rubric.version, hash: metadata.rubricHash },
    runId: metadata.runId, commitSha: metadata.commitSha, createdAt: new Date().toISOString(),
    inputHash: metadata.inputHash, validRun: errors.length === 0,
    earned: cases.reduce((sum, item) => sum + item.earned, 0), maximum: 100,
    allGreen: errors.length === 0 && cases.every(item => item.classification === 'passed')
      && nonScoredRequirements.every(item => item.classification === 'passed')
      && records.every(item => item.classification === 'passed')
      && ['vitest', 'playwright'].every(runner => inputs[runner]?.exitCode === 0)
      && inputs.vitest.report.success === true && inputs.playwright.report.stats.unexpected === 0,
    groups, cases, nonScoredRequirements, errors, runners: metadata.runners,
    note: rubric.description, humanReview: rubric.humanReview,
  };
}

export function verifyRecordedRun(recorded, current, reportHashes) {
  const errors = [];
  for (const field of ['runId', 'commitSha', 'rubricHash', 'inputHash']) {
    if (!recorded?.[field] || recorded[field] !== current[field]) errors.push(`Recorded ${field} does not match the current run.`);
  }
  if (!recorded?.projectRoot || normalized(recorded.projectRoot) !== normalized(current.projectRoot)) errors.push('Recorded project root differs.');
  if (!recorded?.completedAt) errors.push('Recorded run is incomplete.');
  if (recorded?.verificationErrors?.length) errors.push(...recorded.verificationErrors);
  for (const runner of ['vitest', 'playwright']) {
    if (!recorded?.runners?.[runner]?.reportHash || recorded.runners[runner].reportHash !== reportHashes[runner]) {
      errors.push(`${runner} report is missing or changed since the recorded run.`);
    }
  }
  return errors;
}

export async function fingerprintInputs(root) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const absolute = path.join(root, relative);
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      if (error.code !== 'ENOTDIR') throw error;
      hash.update(relative.replaceAll('\\', '/') + '\0');
      hash.update(await readFile(absolute));
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() || entry.isFile()) await visit(path.join(relative, entry.name));
    }
  }
  for (const name of ['src', 'test', 'scripts', 'index.html', 'package.json', 'package-lock.json', 'rubric.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts']) await visit(name);
  return hash.digest('hex');
}

export function renderMarkdown(report) {
  const passed = report.cases.filter(item => item.classification === 'passed').length;
  const progress = (earned, maximum) => {
    const filled = Math.floor(20 * earned / maximum);
    return '`' + '█'.repeat(filled) + '░'.repeat(20 - filled) + '`';
  };
  const state = report.allGreen ? 'all tests green'
    : passed === report.cases.length ? 'all rubric cases passed; other tests remain RED — advisory'
      : `${passed}/${report.cases.length} requirements passed; ${report.cases.length - passed} remaining — RED / advisory`;
  const lines = [
    '# Internal readiness score', '',
    report.validRun
      ? `**${report.earned}/${report.maximum}** ${progress(report.earned, report.maximum)}\n\n${state}`
      : '**Score unavailable** — test evidence is incomplete or invalid; results below are diagnostic only.',
    '', report.note ?? 'Internal rubric; not official competition judging.',
    '', `Commit: \`${report.commitSha}\` · Run: \`${report.runId}\``,
    `Rubric: \`${report.rubric.version}\` · SHA-256: \`${report.rubric.hash}\``, '',
    '| Area | Earned | Available | Progress |', '|---|---:|---:|---|',
    ...report.groups.map(group => `| ${group.group} | ${group.earned} | ${group.maximum} | ${report.validRun ? progress(group.earned, group.maximum) : 'Unavailable'} |`), '',
    '| Requirement | Result | Points |', '|---|---|---:|',
    ...report.cases.map(item => `| ${item.id}: ${item.title.replaceAll('|', '\\|')} | ${item.classification} | ${item.earned}/${item.points} |`), '',
    'Missing, skipped, unimplemented, failed and harness-error results earn zero; their weights stay in the denominator. Smoke/build checks earn no rubric points.', '',
    `Unscored human review: ${(report.humanReview ?? []).join('; ')}.`,
  ];
  if (report.nonScoredRequirements?.length) lines.push(
    '', '## Business requirements (not scored)', '',
    'These requirements must pass before all tests are green. They do not change the 100-point rubric.', '',
    '| Requirement | Result |', '|---|---|',
    ...report.nonScoredRequirements.map(item => `| ${item.id}: ${item.title.replaceAll('|', '\\|')} | ${item.classification} |`),
    '', ...report.nonScoredRequirements.filter(item => item.description).map(item => `${item.id}: ${item.description}`),
  );
  if (report.errors.length) lines.push('', '## Harness findings', '', ...report.errors.map(error => `- ${error}`));
  return lines.join('\n') + '\n';
}
