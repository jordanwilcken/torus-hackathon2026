export type LocalWorkload =
  | { kind: 'integer-sum'; requestId: string; values: number[] }
  | { kind: 'grid-summary'; requestId: string; values: number[] };
export type WorkerEvent = { state: 'running' | 'progress'; at: string; pid: number | null; completed?: number; total?: number };
export type WorkerResult = {
  status: 'done' | 'failed';
  exitCode: number | null; signal: string | null; startedAt: string; completedAt: string;
  pid: number | null; outputText: string | null; error?: string;
};
export type RunWorkload = (
  workload: LocalWorkload,
  onEvent: (event: WorkerEvent) => Promise<void>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<WorkerResult>;
export type WorkloadExecutor = {
  backend: 'node-child-process' | 'cloudflare-durable-object';
  location: 'Application server' | 'Cloudflare';
  run: RunWorkload;
};
