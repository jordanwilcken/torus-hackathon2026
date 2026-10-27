import { pathToFileURL } from 'node:url';

const start = '<!-- scorecard:start -->';
const end = '<!-- scorecard:end -->';

function updatedReadme(text, repository, run) {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (text.split(start).length !== 2 || text.split(end).length !== 2 || to < from) {
    throw new Error('README must contain one ordered scorecard marker pair.');
  }
  const previous = text.slice(from, to).match(/<!-- scorecard:run (\d+) attempt (\d+) -->/g);
  if (previous?.length !== 1) throw new Error('README scorecard ordering metadata is missing or ambiguous.');
  const [number, attempt] = previous[0].match(/\d+/g).map(Number);
  if (number > run.number || (number === run.number && attempt >= run.attempt)) return null;

  const base = `https://github.com/${repository}`;
  const download = run.artifactUrl
    ? `**[Download scorecard + rubric](${run.artifactUrl})**`
    : 'Scorecard download unavailable for this run.';
  const block = [start, `<!-- scorecard:run ${run.number} attempt ${run.attempt} -->`,
    `**[Open latest CI scorecard →](${base}/actions/runs/${run.id})** · ${download} · [All runs](${base}/actions/workflows/requirements.yml?query=branch%3Amain)`,
    '', `Latest reported commit: [\`${run.sha.slice(0, 7)}\`](${base}/commit/${run.sha}) · Run ${run.number}, attempt ${run.attempt}.`, end,
  ].join('\n');
  return text.slice(0, from) + block + text.slice(to + end.length);
}

export async function updateScorecardLinks({ repository, run, token, fetchImpl = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository)
    || !/^\d+$/.test(run.id) || !/^[a-f0-9]{40}$/.test(run.sha)
    || !Number.isSafeInteger(run.number) || run.number < 1
    || !Number.isSafeInteger(run.attempt) || run.attempt < 1) {
    throw new Error('Valid repository, token and CI run identity are required.');
  }
  const artifactPrefix = `https://github.com/${repository}/actions/runs/${run.id}/artifacts/`;
  if (run.artifactUrl && (!run.artifactUrl.startsWith(artifactPrefix)
    || !/^\d+$/.test(run.artifactUrl.slice(artifactPrefix.length)))) {
    throw new Error('The artifact URL must belong to this repository and run.');
  }
  const url = `https://api.github.com/repos/${repository}/contents/README.md`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl(`${url}?ref=main`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Reading README failed (HTTP ${response.status}).`);
    const file = await response.json();
    if (file.type !== 'file' || file.encoding !== 'base64' || !file.sha || typeof file.content !== 'string') {
      throw new Error('README was not returned as a versioned file.');
    }
    const text = updatedReadme(Buffer.from(file.content, 'base64').toString('utf8'), repository, run);
    if (text === null) return { status: 'unchanged' };
    const saved = await fetchImpl(url, { method: 'PUT', headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({
      branch: 'main', sha: file.sha, content: Buffer.from(text).toString('base64'),
      message: `docs: refresh scorecard links for run ${run.number} attempt ${run.attempt}`,
    }) });
    // Refetch after a conflict so both teammate edits and newer results win.
    if ([409, 422].includes(saved.status)) continue;
    if (!saved.ok) throw new Error(`Updating README failed (HTTP ${saved.status}).`);
    return { status: 'updated' };
  }
  throw new Error('README changed repeatedly; no update was forced.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main') {
      throw new Error('Automatic README publication runs only in main-branch CI.');
    }
    const result = await updateScorecardLinks({
      repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN,
      run: { id: process.env.GITHUB_RUN_ID, number: Number(process.env.GITHUB_RUN_NUMBER),
        attempt: Number(process.env.GITHUB_RUN_ATTEMPT), sha: process.env.GITHUB_SHA,
        artifactUrl: process.env.SCORE_ARTIFACT_URL ?? '' },
    });
    console.log(`README scorecard links: ${result.status}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
