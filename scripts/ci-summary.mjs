import { appendFileSync, readFileSync } from 'node:fs';
import { renderMarkdown } from './score-lib.mjs';

const stages = [
  ['Install', 'INSTALL_RESULT'], ['Build', 'BUILD_RESULT'],
  ['Score tooling', 'TOOLING_RESULT'], ['Browser install', 'BROWSER_RESULT'],
  ['Requirement tests', 'REQUIREMENTS_RESULT'],
];

let report;
let score;
let unavailable;
try {
  const candidate = JSON.parse(readFileSync('.reports/score.json', 'utf8'));
  if (candidate.schemaVersion !== 1 || candidate.validRun !== true || candidate.errors?.length !== 0
    || !Array.isArray(candidate.cases) || !candidate.cases.length || !Array.isArray(candidate.groups)
    || !candidate.rubric || typeof candidate.allGreen !== 'boolean' || candidate.maximum !== 100
    || (candidate.allGreen && candidate.earned !== candidate.maximum)
    || !Number.isFinite(candidate.earned) || candidate.earned < 0 || candidate.earned > 100
    || candidate.cases.some(item => !Number.isFinite(item.points) || item.points <= 0
      || !['passed', 'failed', 'unimplemented', 'skipped', 'not-run'].includes(item.classification)
      || item.earned !== (item.classification === 'passed' ? item.points : 0))
    || candidate.cases.reduce((sum, item) => sum + item.points, 0) !== candidate.maximum
    || candidate.cases.reduce((sum, item) => sum + item.earned, 0) !== candidate.earned) {
    throw new Error('The score report is incomplete or invalid.');
  }
  if (process.env.GITHUB_SHA && candidate.commitSha !== process.env.GITHUB_SHA) {
    throw new Error('The score belongs to a different commit.');
  }
  score = renderMarkdown(candidate);
  report = candidate;
} catch (error) {
  unavailable = error.code === 'ENOENT' ? 'No current score report was produced.' : error.message;
}

const healthy = Boolean(report) && stages.slice(0, -1).every(([, key]) => process.env[key] === 'success')
  && ['success', 'failure'].includes(process.env.REQUIREMENTS_RESULT);
const passed = report?.cases.filter(item => item.classification === 'passed').length;
let label = report
  ? `${report.earned}/${report.maximum} - ${report.allGreen ? 'all tests green'
    : `${passed}/${report.cases.length} requirements passed (advisory)`}`
  : 'unavailable - CI needs attention';
if (report && !healthy) label += ' - CI needs attention';

if (process.argv.includes('--conclusion')) {
  // Requirement failures remain RED in the scorecard; only broken CI fails this job.
  process.stdout.write(`${label}\n`);
  process.exitCode = healthy ? 0 : 1;
} else {
  score ??= `# Score unavailable\n\n${unavailable}\n`;
  if (process.env.SCORE_ARTIFACT_URL) score += `\n[Download scorecard and rubric](${process.env.SCORE_ARTIFACT_URL})\n`;
  const status = `\n## ${healthy ? 'CI reporting is healthy' : 'CI needs attention'}\n\n`
    + '| Stage | Result |\n|---|---|\n'
    + stages.map(([label, key]) => `| ${label} | ${process.env[key] || 'not-run'} |`).join('\n')
    + '\n\nRequirement failures are advisory and retain their actual results and zero points. '
    + 'A successful workflow means the build and evidence pipeline worked, not that the product is complete. '
    + 'Build, tooling, browser setup and invalid evidence still fail CI.\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `score_label=${label}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, score + status);
  process.stdout.write(score + status);
}
