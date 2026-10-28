import { assertWorkload, computeWorkload } from './computeWorkload.mjs';
import type { RunWorkload, WorkloadExecutor, WorkerResult } from './WorkloadExecutor.type.ts';

/** Executes JavaScript in the owning Durable Object. No process metadata is invented. */
export const runEdgeWorkload: RunWorkload = async (workload, onEvent, options = {}) => {
  assertWorkload(workload);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new RangeError('Workload timeout must be between 1 and 300000 milliseconds');
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const result = (status: WorkerResult['status'], outputText: string | null, error?: string): WorkerResult => ({
    status, pid: null, exitCode: null, signal: null, startedAt,
    completedAt: new Date().toISOString(), outputText, ...(error ? { error } : {}),
  });
  let stopped: string | undefined;
  const cancellation = Promise.withResolvers<never>();
  function stop(reason: string) {
    if (stopped) return;
    stopped = reason; cancellation.reject(new Error(reason));
  }
  function check() {
    if (options.signal?.aborted) throw new Error('CANCELLED');
    if (stopped) throw new Error(stopped);
    if (Date.now() - started >= timeoutMs) throw new Error('TIMED_OUT');
  }
  const cancel = () => stop('CANCELLED');
  const timer = setTimeout(() => stop('TIMED_OUT'), timeoutMs);
  options.signal?.addEventListener('abort', cancel, { once: true });
  const execute = async () => {
    check();
    await onEvent({ state: 'running', at: startedAt, pid: null });
    check();
    const output = await computeWorkload(workload, async progress => {
      check();
      await onEvent({ state: 'progress', at: new Date().toISOString(), pid: null, ...progress });
      check();
    }, async () => { check(); });
    check();
    return JSON.stringify(output);
  };
  try {
    return result('done', await Promise.race([execute(), cancellation.promise]));
  } catch (error) {
    const messages: Record<string, string> = {
      SUM_OVERFLOW: 'Integer sum exceeds the safe integer range.',
      SUMMARY_OVERFLOW: 'Grid summary exceeds the finite numeric range.',
      CANCELLED: 'Workload was cancelled.', TIMED_OUT: 'Workload timed out.',
    };
    const code = (error as Error)?.message;
    return result('failed', null, Object.hasOwn(messages, code) ? messages[code] : 'Workload execution or progress recording failed.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
};

export const edgeWorkloadExecutor: WorkloadExecutor = {
  backend: 'cloudflare-durable-object', location: 'Cloudflare', run: runEdgeWorkload,
};
