import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('actual workerd rejects uploads without reading their streams after the response lifetime', async () => {
  test.setTimeout(120_000);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./http-stream-probe.ts', import.meta.url))], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let diagnostics = '';
  let truncated = false;
  const capture = (part: Buffer) => {
    const appended = diagnostics + part.toString();
    truncated ||= appended.length > 64_000;
    diagnostics = appended.slice(-64_000);
  };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  let finished = false;
  const ended = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { finished = true; resolve(code); });
  });
  const timeout = setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, 100_000);
  try {
    expect(await ended, diagnostics).toBe(0);
    expect(truncated, 'All runtime diagnostics must be inspected').toBe(false);
    expect(diagnostics).toContain('WORKERD_STREAM_CASES=7');
    expect(diagnostics).not.toMatch(/Can't read from request stream after response has been sent|Uncaught (?:TypeError|Error)/);
  } finally {
    clearTimeout(timeout);
    if (!finished) { child.kill('SIGKILL'); await ended.catch(() => {}); }
  }
});
