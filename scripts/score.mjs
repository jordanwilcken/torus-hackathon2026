import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fingerprintInputs, renderMarkdown, scoreReports, sha256, validateRubric, verifyRecordedRun } from './score-lib.mjs';

const root = process.cwd();
const reportsRoot = path.join(root, '.reports');
const reportOnly = process.argv.slice(2).includes('--report-only');
if (process.argv.slice(2).some(arg => arg !== '--report-only')) throw new Error('Usage: node scripts/score.mjs [--report-only]');
await mkdir(reportsRoot, { recursive: true });
const rubricBytes = await readFile(path.join(root, 'rubric.json'));
const rubric = JSON.parse(rubricBytes.toString('utf8'));
validateRubric(rubric);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false });
const commitSha = process.env.GITHUB_SHA || (git.status === 0 ? git.stdout.trim() : 'uncommitted');
const current = { projectRoot: root, commitSha, rubricHash: sha256(rubricBytes), inputHash: await fingerprintInputs(root) };
let metadata;
let inputs = {};
let verificationErrors = [];

const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

async function loadReport(file) {
  try {
    const bytes = await readFile(file);
    try { return { report: JSON.parse(bytes.toString('utf8')), reportHash: sha256(bytes) }; }
    catch { return { error: 'Runner report is not valid JSON.', reportHash: sha256(bytes) }; }
  } catch (error) { return { error: `Runner report could not be read: ${error.code ?? error.message}` }; }
}

async function runRunner(name, runDirectory) {
  const reportPath = path.join(runDirectory, `${name}.json`);
  const entry = name === 'vitest' ? 'node_modules/vitest/vitest.mjs' : 'node_modules/@playwright/test/cli.js';
  const args = name === 'vitest'
    ? [path.join(root, entry), 'run', `--reporter=${path.join(root, 'scripts/score-vitest-reporter.mjs')}`, '--reporter=json', `--outputFile=${reportPath}`]
    : [path.join(root, entry), 'test', '--reporter=json'];
  const startedAt = new Date().toISOString();
  let stdout = '';
  let stderr = '';
  const outcome = await new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
    });
    let startupError;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { startupError = error.message; });
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal, error: startupError }));
  });
  await writeFile(path.join(runDirectory, `${name}.stdout.log`), stdout);
  await writeFile(path.join(runDirectory, `${name}.stderr.log`), stderr);
  const loaded = await loadReport(reportPath);
  const result = { ...outcome, ...loaded };
  metadata.runners[name] = {
    command: [process.execPath, ...args], startedAt, finishedAt: new Date().toISOString(),
    exitCode: outcome.exitCode, signal: outcome.signal, error: result.error ?? null,
    reportPath: `${name}.json`, reportHash: loaded.reportHash ?? null,
  };
  inputs[name] = result;
  await writeJson(path.join(runDirectory, 'metadata.json'), metadata);
  process.stdout.write(`${name}: exit ${outcome.exitCode ?? outcome.signal ?? 'error'}\n`);
}

if (reportOnly) {
  try {
    const pointer = JSON.parse(await readFile(path.join(reportsRoot, 'current-run.json'), 'utf8'));
    if (typeof pointer.runId !== 'string' || !/^[0-9a-f-]{36}$/.test(pointer.runId)) throw new Error('Invalid current-run ID.');
    const directory = path.join(reportsRoot, 'runs', pointer.runId);
    metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
    const hashes = {};
    for (const name of ['vitest', 'playwright']) {
      const loaded = await loadReport(path.join(directory, `${name}.json`));
      hashes[name] = loaded.reportHash;
      inputs[name] = { ...metadata.runners?.[name], ...loaded };
    }
    verificationErrors = verifyRecordedRun(metadata, { ...current, runId: pointer.runId }, hashes);
  } catch (error) {
    verificationErrors = [`Cannot use the recorded current run: ${error.message}`];
  }
  metadata ??= { ...current, runId: 'unverified', runners: {} };
} else {
  metadata = { schemaVersion: 1, ...current, runId: randomUUID(), startedAt: new Date().toISOString(), runners: {} };
  const directory = path.join(reportsRoot, 'runs', metadata.runId);
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(reportsRoot, 'current-run.json'), { runId: metadata.runId });
  await writeJson(path.join(directory, 'metadata.json'), metadata);
  for (const name of ['vitest', 'playwright']) {
    try { await runRunner(name, directory); }
    catch (error) {
      inputs[name] = { exitCode: null, error: error.message };
      metadata.runners[name] = { exitCode: null, error: error.message, reportHash: null };
    }
  }
  metadata.completedAt = new Date().toISOString();
  if (await fingerprintInputs(root) !== current.inputHash) verificationErrors.push('Test inputs changed during the run.');
  metadata.verificationErrors = verificationErrors;
  await writeJson(path.join(directory, 'metadata.json'), metadata);
}

const report = scoreReports(rubric, inputs, metadata, verificationErrors);
await writeJson(path.join(reportsRoot, 'score.json'), report);
await writeFile(path.join(reportsRoot, 'score.md'), renderMarkdown(report));
if (!reportOnly) {
  const directory = path.join(reportsRoot, 'runs', metadata.runId);
  await writeJson(path.join(directory, 'score.json'), report);
  await writeFile(path.join(directory, 'score.md'), renderMarkdown(report));
}
process.stdout.write(`Internal readiness: ${report.earned}/${report.maximum}; ${report.allGreen ? 'green' : 'RED / advisory'}\n`);
process.exitCode = report.allGreen ? 0 : 1;
