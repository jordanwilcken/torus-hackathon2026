/** Validate the bounded operations supported by both server runtimes. */
export function assertWorkload(workload) {
  if (!workload || !['integer-sum', 'grid-summary'].includes(workload.kind)) throw new TypeError('Unsupported local workload');
  if (typeof workload.requestId !== 'string' || !workload.requestId.trim() || workload.requestId.length > 128) throw new TypeError('Local workload requestId must contain 1 to 128 characters');
  if (!Array.isArray(workload.values) || workload.values.length > 100_000) throw new RangeError('Local workload accepts at most 100000 values');
  if (workload.kind === 'integer-sum' && !workload.values.every(Number.isSafeInteger)) throw new TypeError('Integer sum operands must be safe integers');
  if (workload.kind === 'grid-summary' && !workload.values.every(Number.isFinite)) throw new TypeError('Grid summary values must be finite');
}

/** Actual computation. Callers own process/isolate lifecycle, progress persistence and cancellation. */
export async function computeWorkload(workload, onProgress = async (_progress) => {}, cooperate = async () => {}) {
  assertWorkload(workload);
  const { kind, requestId, values } = workload;
  let sum = 0;
  let min = null;
  let max = null;
  await onProgress({ completed: 0, total: values.length });
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    sum += value;
    if (kind === 'integer-sum' && !Number.isSafeInteger(sum)) throw new Error('SUM_OVERFLOW');
    if (!Number.isFinite(sum)) throw new Error('SUMMARY_OVERFLOW');
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
    if ((index + 1) % 1000 === 0 || index + 1 === values.length) {
      await onProgress({ completed: index + 1, total: values.length });
      await cooperate();
    }
  }
  return kind === 'integer-sum' ? { requestId, sum }
    : { requestId, count: values.length, sum, mean: values.length ? sum / values.length : null, min, max };
}
