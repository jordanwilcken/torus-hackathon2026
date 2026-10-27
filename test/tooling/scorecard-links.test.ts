import assert from 'node:assert/strict';
import test from 'node:test';
import { updateScorecardLinks } from '../../scripts/update-scorecard-links.mjs';

const repository = 'example/project';
const run = { id: '200', number: 4, attempt: 1, sha: 'a'.repeat(40),
  artifactUrl: 'https://github.com/example/project/actions/runs/200/artifacts/300' };
const readme = '# Project\n\nTeam introduction.\n\n<!-- scorecard:start -->\n'
  + '<!-- scorecard:run 3 attempt 1 -->\nOld run and download links.\n<!-- scorecard:end -->\n\nTeam instructions.\n';

// The remote file changes only when its blob SHA still matches the write request.
function remote(initial = readme, beforeWrite?: (body: { sha: string; content: string }) => Response | undefined) {
  const state = { text: initial, sha: 'blob-1', commits: 0, attempts: 0 };
  const fetchImpl: typeof fetch = async (input, options = {}) => {
    const url = String(input);
    if (options.method === 'PUT') {
      assert.equal(url, 'https://api.github.com/repos/example/project/contents/README.md');
      const body = JSON.parse(String(options.body));
      assert.equal(body.branch, 'main');
      state.attempts++;
      const conflict = beforeWrite?.(body);
      if (conflict) return conflict;
      if (body.sha !== state.sha) return new Response('', { status: 409 });
      state.text = Buffer.from(body.content, 'base64').toString('utf8');
      state.sha = 'written-blob';
      state.commits++;
      return Response.json({ commit: { html_url: 'https://github.com/example/project/commit/bot' } });
    }
    assert.equal(url, 'https://api.github.com/repos/example/project/contents/README.md?ref=main');
    return Response.json({ type: 'file', encoding: 'base64', sha: state.sha,
      content: Buffer.from(state.text).toString('base64') });
  };
  return { state, fetchImpl };
}
const options = (api: ReturnType<typeof remote>, selected = run) => ({ repository, run: selected, token: 'test-token', fetchImpl: api.fetchImpl });

test('a newer run updates direct links and tested commit while preserving the rest of README', async () => {
  const api = remote();
  const result = await updateScorecardLinks(options(api));
  assert.equal(result.status, 'updated');
  assert.equal(api.state.commits, 1);
  assert.match(api.state.text, /actions\/runs\/200\)/);
  assert.ok(api.state.text.includes(run.artifactUrl));
  assert.ok(api.state.text.includes(run.sha.slice(0, 7)));
  assert.ok(api.state.text.startsWith('# Project\n\nTeam introduction.\n\n'));
  assert.ok(api.state.text.endsWith('\n\nTeam instructions.\n'));
});

test('older runs and repeated publication do not replace current links or make commits', async () => {
  for (const number of [2, 3]) {
    const api = remote();
    assert.equal((await updateScorecardLinks(options(api, { ...run, number }))).status, 'unchanged');
    assert.equal(api.state.commits, 0);
    assert.equal(api.state.text, readme);
  }
});

test('a later attempt of the same run replaces the previous attempt', async () => {
  const api = remote();
  await updateScorecardLinks(options(api, { ...run, number: 3, attempt: 2 }));
  assert.equal(api.state.commits, 1);
  assert.match(api.state.text, /scorecard:run 3 attempt 2/);
});

test('a run without an artifact clears the old download rather than pairing it with the new run', async () => {
  const api = remote(readme.replace('Old run and download links.', run.artifactUrl));
  await updateScorecardLinks(options(api, { ...run, artifactUrl: '' }));
  assert.match(api.state.text, /download unavailable/i);
  assert.doesNotMatch(api.state.text, /\/artifacts\//);
});

test('missing or ambiguous markers fail without changing the remote README', async () => {
  for (const text of ['# No scorecard block', readme + '<!-- scorecard:start -->', readme.replace('scorecard:run 3 attempt 1', 'invalid metadata')]) {
    const api = remote(text);
    await assert.rejects(updateScorecardLinks(options(api)), /scorecard/i);
    assert.equal(api.state.commits, 0);
    assert.equal(api.state.text, text);
  }
});

test('a concurrent teammate edit is preserved when publication retries', async () => {
  const api = remote(readme, () => {
    if (api.state.attempts !== 1) return;
    api.state.text += '\nNew teammate instructions.\n';
    api.state.sha = 'human-edit';
    return new Response('', { status: 409 });
  });
  await updateScorecardLinks(options(api));
  assert.equal(api.state.commits, 1);
  assert.ok(api.state.text.endsWith('\nNew teammate instructions.\n'));
  assert.ok(api.state.text.includes(run.artifactUrl));
});

test('a newer scorecard published during a conflict wins over the older retry', async () => {
  const api = remote(readme, () => {
    api.state.text = readme.replace('run 3 attempt 1', 'run 5 attempt 1');
    api.state.sha = 'newer-report';
    return new Response('', { status: 409 });
  });
  assert.equal((await updateScorecardLinks(options(api))).status, 'unchanged');
  assert.equal(api.state.commits, 0);
  assert.match(api.state.text, /run 5 attempt 1/);
});

test('write permission errors remain visible and never claim an update', async () => {
  const api = remote(readme, () => new Response('', { status: 403 }));
  await assert.rejects(updateScorecardLinks(options(api)), /403/);
  assert.equal(api.state.commits, 0);
});

test('repeated conflicts stop without overwriting anyone', async () => {
  const api = remote(readme, () => new Response('', { status: 409 }));
  await assert.rejects(updateScorecardLinks(options(api)), /changed repeatedly/i);
  assert.equal(api.state.attempts, 3);
  assert.equal(api.state.commits, 0);
});

test('an artifact from another run is rejected before publication', async () => {
  const api = remote();
  await assert.rejects(updateScorecardLinks(options(api, { ...run, artifactUrl: run.artifactUrl.replace('/200/', '/199/') })), /artifact/i);
  assert.equal(api.state.commits, 0);
});
