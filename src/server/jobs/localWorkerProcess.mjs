import { assertWorkload, computeWorkload } from './computeWorkload.mjs';

const maxInputBytes = 4 * 1024 * 1024;
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
  try {
    const workload = JSON.parse(text);
    assertWorkload(workload);
    return workload;
  } catch { throw new Error('INVALID_INPUT'); }
}

try {
  const output = await computeWorkload(await readWorkload(),
    async progress => { send({ type: 'progress', ...progress }); },
    () => new Promise(resolve => setImmediate(resolve)));
  send({ type: 'result', outputText: JSON.stringify(output) });
} catch (error) {
  const code = ['INVALID_INPUT', 'SUM_OVERFLOW', 'SUMMARY_OVERFLOW'].includes(error?.message) ? error.message : 'WORKER_FAILED';
  send({ type: 'error', code });
  process.exitCode = 1;
}
