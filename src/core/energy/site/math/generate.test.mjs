import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { compileMath } from './generate.mjs';

const fence = String.fromCharCode(96).repeat(3);
function equation(name, inputs, latex, result = 'real') {
  return ['## ' + name, '', fence + 'json', JSON.stringify({ name, inputs, result }), fence,
    '', '$$', latex, '$$', ''].join('\n');
}
const storedEnergy = equation('usableEnergy', { storedKWh: 'real', protectedKWh: 'real' },
  '\\max(0,\\mathrm{storedKWh}-\\mathrm{protectedKWh})');
const generator = fileURLToPath(new URL('./generate.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [generator, ...args], { encoding: 'utf8' });

test('authored equations produce executable standalone numeric JavaScript', async () => {
  const artifact = compileMath(storedEnergy, 'energy.math.md');
  const generated = await import('data:text/javascript,' + encodeURIComponent(artifact));
  assert.equal(generated.usableEnergy({ storedKWh: 6, protectedKWh: 2 }), 4);
  assert.equal(generated.usableEnergy({ storedKWh: 2, protectedKWh: 4 }), 0);
  assert.match(artifact, /@param.*"protectedKWh": number.*"storedKWh": number/);
  assert.doesNotMatch(artifact, /\bimport\b|runtime\.load|new Function/);
  assert.equal(compileMath(storedEnergy, 'energy.math.md'), artifact);
});

test('changing the authored formula changes the executable result and source fingerprint', async () => {
  const changed = storedEnergy.replace('\\max(0,', '2\\max(0,');
  const artifact = compileMath(changed, 'energy.math.md');
  const generated = await import('data:text/javascript,' + encodeURIComponent(artifact));
  assert.equal(generated.usableEnergy({ storedKWh: 6, protectedKWh: 2 }), 8);
  assert.notEqual(artifact, compileMath(storedEnergy, 'energy.math.md'));
  assert.match(artifact, /Source SHA-256: [a-f0-9]{64}/);
});

test('check mode observes stale output and never overwrites it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'site-energy-math-'));
  try {
    const source = join(directory, 'energy.math.md'), output = join(directory, 'energy.generated.js');
    await writeFile(source, storedEnergy);
    let result = run(source, output);
    assert.equal(result.status, 0, result.stderr);
    const original = await readFile(output, 'utf8');
    result = run(source, output, '--check');
    assert.equal(result.status, 0, result.stderr);
    await writeFile(source, storedEnergy + '\nA changed explanation.\n');
    result = run(source, output, '--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stale/);
    assert.equal(await readFile(output, 'utf8'), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime-dependent scalar math cannot silently become an incomplete standalone function', () => {
  assert.throws(() => compileMath(equation('specialFunction', { x: 'real' }, '\\Gamma(\\mathrm{x})'),
    'special.math.md'), /runtime helpers|preambles/);
});

test('incomplete declarations, non-real shapes and missing scalar inputs fail closed', () => {
  assert.throws(() => compileMath(storedEnergy + '\n$$\nx+1\n', 'energy.math.md'), /Incomplete/);
  assert.throws(() => compileMath(equation('arraySum', { x: 'list<real>' }, '\\operatorname{Length}(x)'),
    'energy.math.md'), /scalar real/);
  assert.throws(() => compileMath(equation('missing', { x: 'real' }, 'x+y'),
    'energy.math.md'), /every free input/);
  assert.throws(() => compileMath(storedEnergy + storedEnergy, 'energy.math.md'), /duplicate/);
});
test('ordinary LF and CRLF checkouts share a fingerprint and pass freshness without rewriting output', async () => {
  const artifact = compileMath(storedEnergy, 'energy.math.md');
  assert.equal(compileMath(storedEnergy.replace(/\n/g, '\r\n'), 'energy.math.md'), artifact);
  const directory = await mkdtemp(join(tmpdir(), 'site-energy-math-eol-'));
  try {
    const source = join(directory, 'energy.math.md'), output = join(directory, 'energy.generated.js');
    const checkout = artifact.replace(/\n/g, '\r\n');
    await writeFile(source, storedEnergy.replace(/\n/g, '\r\n'));
    await writeFile(output, checkout);
    const result = run(source, output, '--check');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, 'utf8'), checkout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
