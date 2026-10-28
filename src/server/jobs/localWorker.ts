import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type LocalWorkload =
  | { kind: 'integer-sum'; requestId: string; values: number[] }
  | { kind: 'grid-summary'; requestId: string; values: number[] };
export type WorkerEvent = { state: 'running' | 'progress'; at: string; pid: number; completed?: number; total?: number };
export type WorkerResult = {
  exitCode: number | null; signal: string | null; startedAt: string; completedAt: string;
  pid: number | null; outputText: string | null; error?: string;
};

const maxValues = 100_000;
const maxOutputBytes = 64 * 1024;
const processFile = fileURLToPath(new URL('./localWorkerProcess.mjs', import.meta.url));
const childErrors: Record<string, string> = {
  INVALID_INPUT: 'Local worker rejected its input.',
  SUM_OVERFLOW: 'Integer sum exceeds the safe integer range.',
  SUMMARY_OVERFLOW: 'Grid summary exceeds the finite numeric range.',
  WORKER_FAILED: 'Local worker failed.',
};

function inputFor(workload: LocalWorkload): string {
  if (!workload || !['integer-sum', 'grid-summary'].includes(workload.kind)) throw new TypeError('Unsupported local workload');
  if (typeof workload.requestId !== 'string' || !workload.requestId.trim() || workload.requestId.length > 128) throw new TypeError('Local workload requestId must contain 1 to 128 characters');
  if (!Array.isArray(workload.values) || workload.values.length > maxValues) throw new RangeError('Local workload accepts at most 100000 values');
  if (workload.kind === 'integer-sum' && !workload.values.every(Number.isSafeInteger)) throw new TypeError('Integer sum operands must be safe integers');
  if (workload.kind === 'grid-summary' && !workload.values.every(Number.isFinite)) throw new TypeError('Grid summary values must be finite');
  return JSON.stringify({ kind: workload.kind, requestId: workload.requestId, values: workload.values });
}

/** Executes an allowlisted CPU operation; it never accepts executable code or shell arguments. */
export async function runLocalWorkload(
  workload: LocalWorkload,
  onEvent: (event: WorkerEvent) => Promise<void>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WorkerResult> {
  const input = inputFor(workload);
  const total = workload.values.length;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new RangeError('Local workload timeout must be between 1 and 300000 milliseconds');
  let startedAt = new Date().toISOString();
  if (options.signal?.aborted) return { exitCode: null, signal: null, startedAt, completedAt: startedAt, pid: null, outputText: null, error: 'Local workload was cancelled.' };

  return new Promise<WorkerResult>(resolve => {
    // Deliberately exclude EIA credentials, GitHub tokens, NODE_OPTIONS and other inherited application configuration.
    const env = process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
    const child = spawn(process.execPath, [processFile], { shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let closed = false;
    let failure: string | undefined;
    let childError: string | undefined;
    let outputText: string | null = null;
    let bytes = 0;
    let pendingLine = '';
    let completed = -1;
    let events = Promise.resolve();
    let stopCallbacks!: () => void;
    const stopped = new Promise<void>(done => { stopCallbacks = done; });
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    function fail(message: string) {
      if (failure) return;
      failure = message;
      stopCallbacks();
      if (!closed) {
        child.stdin.destroy();
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 1000);
      }
    }

    function emit(event: WorkerEvent): Promise<void> {
      events = events.then(async () => { if (!failure) await onEvent(event); })
        .catch(() => { fail('Local worker event handling failed.'); });
      return events;
    }

    function acceptLine(line: string) {
      if (failure) return;
      try {
        const message = JSON.parse(line);
        if (message?.type === 'progress' && Number.isInteger(message.completed) && message.completed >= completed && message.completed >= 0 && message.completed <= total && message.total === total) {
          completed = message.completed;
          void emit({ state: 'progress', at: new Date().toISOString(), pid: child.pid!, completed, total });
        } else if (message?.type === 'result' && typeof message.outputText === 'string' && outputText === null) {
          outputText = message.outputText;
        } else if (message?.type === 'error' && typeof message.code === 'string' && Object.hasOwn(childErrors, message.code)) {
          childError = childErrors[message.code];
        } else fail('Local worker returned an invalid response.');
      } catch { fail('Local worker returned an invalid response.'); }
    }

    function countOutput(length: number): boolean {
      bytes += length;
      if (bytes > maxOutputBytes) fail('Local worker exceeded its output limit.');
      return !failure;
    }

    const abort = () => fail('Local workload was cancelled.');
    const timer = setTimeout(() => fail('Local workload timed out.'), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdin.on('error', () => { if (!failure) fail('Local worker input could not be delivered.'); });
    child.on('error', () => fail('Local worker could not be started.'));
    child.once('spawn', () => {
      startedAt = new Date().toISOString();
      void emit({ state: 'running', at: startedAt, pid: child.pid! }).then(() => {
        if (!failure && !closed) child.stdin.end(input);
      });
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!countOutput(Buffer.byteLength(chunk))) return;
      pendingLine += chunk;
      let end;
      while ((end = pendingLine.indexOf('\n')) !== -1) {
        const line = pendingLine.slice(0, end);
        pendingLine = pendingLine.slice(end + 1);
        acceptLine(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { countOutput(chunk.length); });
    child.once('close', (exitCode, signal) => {
      closed = true;
      const completedAt = new Date().toISOString();
      void (async () => {
        await Promise.race([events, stopped]);
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', abort);
        const error = failure ?? childError ?? (exitCode !== 0 || signal || outputText === null || pendingLine.length ? 'Local worker did not produce a successful result.' : undefined);
        resolve({ exitCode, signal, startedAt, completedAt, pid: child.pid ?? null, outputText: error ? null : outputText, ...(error ? { error } : {}) });
      })();
    });
    if (options.signal?.aborted) abort();
  });
}
