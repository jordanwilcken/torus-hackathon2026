import { afterEach, expect, test, vi } from 'vitest';
import { runLocalWorkload } from '../../../src/server/jobs/localWorker';
import type { LocalWorkload, WorkerEvent } from '../../../src/server/jobs/localWorker';

afterEach(() => vi.unstubAllEnvs());

function expectClosed(pid: number | null) {
  expect(pid).not.toBeNull();
  let exists = false;
  try { process.kill(pid!, 0); exists = true; }
  catch (error) { expect((error as NodeJS.ErrnoException).code).toBe('ESRCH'); }
  expect(exists).toBe(false);
}

test('executes an integer sum in a real child and reports its progress and exact output', async () => {
  const events: WorkerEvent[] = [];
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'sum-1', values: [1, 2, 3, 4] }, async event => { events.push(event); });

  expect(result).toMatchObject({ exitCode: 0, signal: null, outputText: '{"requestId":"sum-1","sum":10}' });
  expect(result.error).toBeUndefined();
  expect(result.pid).not.toBe(process.pid);
  expect(events[0]).toMatchObject({ state: 'running', pid: result.pid });
  expect(events.at(-1)).toMatchObject({ state: 'progress', pid: result.pid, completed: 4, total: 4 });
  expect(Date.parse(result.completedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
  expectClosed(result.pid);
});

test('executes grid statistics over supplied values and preserves the request identity', async () => {
  const result = await runLocalWorkload({ kind: 'grid-summary', requestId: 'grid-1', values: [3000, 3500, 4000] }, async () => {});
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.outputText!)).toEqual({ requestId: 'grid-1', count: 3, sum: 10500, mean: 3500, min: 3000, max: 4000 });
  expectClosed(result.pid);
});

test('empty grid input leaves undefined statistics null instead of manufacturing observations', async () => {
  const result = await runLocalWorkload({ kind: 'grid-summary', requestId: 'empty', values: [] }, async () => {});
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.outputText!)).toEqual({ requestId: 'empty', count: 0, sum: 0, mean: null, min: null, max: null });
  expectClosed(result.pid);
});

test('valid operands whose sum overflows fail inside the actual child process', async () => {
  const events: WorkerEvent[] = [];
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'overflow', values: [Number.MAX_SAFE_INTEGER, 1] }, async event => { events.push(event); });
  expect(events[0]).toMatchObject({ state: 'running', pid: result.pid });
  expect(result.exitCode).not.toBe(0);
  expect(result.outputText).toBeNull();
  expect(result.error).toBe('Integer sum exceeds the safe integer range.');
  expectClosed(result.pid);
});

test('a persistence callback failure ends the child and cannot return successful output or raw errors', async () => {
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'callback-fails', values: [1, 2] }, async () => {
    throw new Error('secret-fixture-value');
  });
  expect(result.outputText).toBeNull();
  expect(result.error).toBe('Local worker event handling failed.');
  expect(JSON.stringify(result)).not.toContain('secret-fixture-value');
  expectClosed(result.pid);
});

test('cancellation during progress closes the actual child before returning failure', async () => {
  const controller = new AbortController();
  const events: WorkerEvent[] = [];
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'cancelled', values: Array.from({ length: 100_000 }, () => 1) }, async event => {
    events.push(event);
    if (event.state === 'progress') controller.abort();
  }, { signal: controller.signal });
  expect(events.some(event => event.state === 'progress')).toBe(true);
  expect(result.outputText).toBeNull();
  expect(result.error).toBe('Local workload was cancelled.');
  expectClosed(result.pid);
});

test('timeout also covers a stalled event callback and reaps its waiting child', async () => {
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'timeout', values: [1] }, async () => new Promise(() => {}), { timeoutMs: 100 });
  expect(result.outputText).toBeNull();
  expect(result.error).toBe('Local workload timed out.');
  expectClosed(result.pid);
});

test('child startup excludes inherited Node execution options', async () => {
  vi.stubEnv('NODE_OPTIONS', '--this-option-must-not-reach-the-worker');
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'isolated', values: [7] }, async () => {});
  expect(result).toMatchObject({ exitCode: 0, outputText: '{"requestId":"isolated","sum":7}' });
  expectClosed(result.pid);
});

test('an already cancelled request starts no process or callbacks', async () => {
  const controller = new AbortController();
  controller.abort();
  const events: WorkerEvent[] = [];
  const result = await runLocalWorkload({ kind: 'integer-sum', requestId: 'not-started', values: [1] }, async event => { events.push(event); }, { signal: controller.signal });
  expect(result).toMatchObject({ pid: null, outputText: null, error: 'Local workload was cancelled.' });
  expect(events).toEqual([]);
});

test.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects the invalid integer operand %s before execution', async value => {
  await expect(runLocalWorkload({ kind: 'integer-sum', requestId: 'invalid', values: [value] }, async () => {})).rejects.toThrow(/safe integers/);
});

test('rejects an oversized input and an unlisted operation', async () => {
  await expect(runLocalWorkload({ kind: 'integer-sum', requestId: 'too-large', values: Array.from({ length: 100_001 }, () => 1) }, async () => {})).rejects.toThrow(/100000/);
  await expect(runLocalWorkload({ kind: 'shell-command', requestId: 'unsupported', values: [] } as unknown as LocalWorkload, async () => {})).rejects.toThrow(/Unsupported local workload/);
  await expect(runLocalWorkload({ kind: 'grid-summary', requestId: 'invalid-grid', values: [NaN] }, async () => {})).rejects.toThrow(/finite/);
});
