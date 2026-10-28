const maxInputBytes = 4 * 1024 * 1024;
const maxValues = 100_000;
const send = message => process.stdout.write(JSON.stringify(message) + '\n');

async function readWorkload() {
  let text = '';
  let size = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size > maxInputBytes) throw new Error('INVALID_INPUT');
    text += chunk;
  }
  let workload;
  try { workload = JSON.parse(text); } catch { throw new Error('INVALID_INPUT'); }
  if (!workload || !['integer-sum', 'grid-summary'].includes(workload.kind) ||
    typeof workload.requestId !== 'string' || !workload.requestId.trim() || workload.requestId.length > 128 ||
    !Array.isArray(workload.values) || workload.values.length > maxValues ||
    !workload.values.every(workload.kind === 'integer-sum' ? Number.isSafeInteger : Number.isFinite)) throw new Error('INVALID_INPUT');
  return workload;
}

async function execute({ kind, requestId, values }) {
  let sum = 0;
  let min = null;
  let max = null;
  send({ type: 'progress', completed: 0, total: values.length });
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    sum += value;
    if (kind === 'integer-sum' && !Number.isSafeInteger(sum)) throw new Error('SUM_OVERFLOW');
    if (!Number.isFinite(sum)) throw new Error('SUMMARY_OVERFLOW');
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
    if ((index + 1) % 1000 === 0 || index + 1 === values.length) {
      send({ type: 'progress', completed: index + 1, total: values.length });
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return kind === 'integer-sum' ? { requestId, sum }
    : { requestId, count: values.length, sum, mean: values.length ? sum / values.length : null, min, max };
}

try {
  const output = await execute(await readWorkload());
  send({ type: 'result', outputText: JSON.stringify(output) });
} catch (error) {
  const code = ['INVALID_INPUT', 'SUM_OVERFLOW', 'SUMMARY_OVERFLOW'].includes(error?.message) ? error.message : 'WORKER_FAILED';
  send({ type: 'error', code });
  process.exitCode = 1;
}
