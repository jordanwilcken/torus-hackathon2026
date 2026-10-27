import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const stages = [
  ['Install', 'INSTALL_RESULT'], ['Build', 'BUILD_RESULT'],
  ['Score tooling', 'TOOLING_RESULT'], ['Browser install', 'BROWSER_RESULT'],
  ['Requirement tests', 'REQUIREMENTS_RESULT'],
];

if (process.argv.includes('--conclusion')) {
  // Advisory means no required check/merge gate; it does not mean false green.
  process.exitCode = stages.every(([, key]) => process.env[key] === 'success') ? 0 : 1;
} else {
  const score = existsSync('.reports/score.md')
    ? readFileSync('.reports/score.md', 'utf8')
    : 'Score unavailable: the reporting process did not produce current evidence.\n';
  const status = '\n## Build evidence\n\n| Stage | Result |\n|---|---|\n'
    + stages.map(([label, key]) => `| ${label} | ${process.env[key] || 'not-run'} |`).join('\n')
    + '\n\nTests and scores guide implementation. This workflow does not create PRs, deploy, or configure required checks.\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, score + status);
  else process.stdout.write(score + status);
}
