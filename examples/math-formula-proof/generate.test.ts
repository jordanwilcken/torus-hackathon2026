import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

async function generatedMath(markdown: string, filename = 'formulas.math.md') {
  const folder = await mkdtemp(fileURLToPath(new URL('./.math-test-', import.meta.url)));
  const input = path.join(folder, filename);
  const output = path.join(folder, 'formulas.generated.ts');
  try {
    await writeFile(input, markdown);
    execFileSync(process.execPath, [fileURLToPath(new URL('./generate.mjs', import.meta.url)), input, output], { stdio: 'pipe' });
    return { functions: await import(pathToFileURL(output).href), code: await readFile(output, 'utf8') };
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
    await rmdir(folder);
  }
}

const examples = await generatedMath(await readFile(new URL('./examples.math.md', import.meta.url), 'utf8'));
const impact = await generatedMath(await readFile(new URL('./impact.math.md', import.meta.url), 'utf8'));

test('plain math infers numeric inputs and uses the filename for its export', async () => {
  const generated = await generatedMath('$$\r\na x^2 + b x + c\r\n$$\r\n', 'polynomial.math.md');
  assert.equal(generated.functions.polynomial({ a: 2, b: 3, c: 4, x: 5 }), 69);
  assert.match(generated.code, /"a": number/);
  assert.match(generated.code, /"b": number/);
  assert.match(generated.code, /"c": number/);
  assert.match(generated.code, /"x": number/);
});

test('headings name multiple math blocks without JSON', async () => {
  const generated = await generatedMath('## Sales tax\n\n$$\np r\n$$\n\n## Net price\n\n$$\np-d\n$$\n');
  assert.equal(generated.functions.salesTax({ p: 100, r: 0.08 }), 8);
  assert.equal(generated.functions.netPrice({ p: 100, d: 5 }), 95);
});

test('optional hints can override a name or symbol while other inputs are inferred', async () => {
  const generated = await generatedMath('## Display label\n\n```json\n{"name":"offset","inputs":{"e":"real"}}\n```\n\n$$\ne+x\n$$\n');
  assert.equal(generated.functions.offset({ e: 2, x: 3 }), 5);
});

test('explicit indexed math can infer an array without JSON', async () => {
  const generated = await generatedMath('## Squared sum\n\n$$\n\\sum_{i=1}^{\\operatorname{Length}(x)}\\operatorname{At}(x,i)^2\n$$\n');
  assert.equal(generated.functions.squaredSum({ x: [2, 3, 4] }), 29);
});

test('a polynomial infers its numeric inputs without JSON', () => {
  assert.equal(examples.functions.polynomial({ a: 2, b: 3, c: 4, x: 5 }), 69);
  assert.match(examples.code, /"a": number; "b": number; "c": number; "x": number/);
});

test('piecewise branches remain intact, including zero', () => {
  assert.equal(examples.functions.piecewise({ x: 3 }), 9);
  assert.equal(examples.functions.piecewise({ x: -3 }), 3);
  assert.equal(examples.functions.piecewise({ x: 0 }), 0);
});

test('an indexed sum uses Cortex helpers and keeps its own input scope', () => {
  assert.equal(examples.functions.sumSquares({ x: [2, 3, 4] }), 29);
  assert.equal(examples.functions.sumSquares({ x: [] }), 0);
  assert.match(examples.code, /_SYS\.atNumeric/);
  assert.match(examples.code, /"x": Array<number>/);
});

test('a constraint returns a boolean rather than solving an optimization', () => {
  assert.equal(examples.functions.withinLimits({ f: 5, d: 10, u: 3, r: 3 }), true);
  assert.equal(examples.functions.withinLimits({ f: 5, d: 10, u: 2, r: 3 }), false);
  assert.equal(examples.functions.withinLimits({ f: 11, d: 10, u: 3, r: 3 }), false);
});

test('tuple results retain both values and their TypeScript shape', () => {
  assert.deepEqual(examples.functions.circlePoint({ t: 0 }), [1, 0]);
  assert.match(examples.code, /=> \[number \| \{ re: number; im: number \}, number \| \{ re: number; im: number \}\]/);
});

test('inference does not falsely narrow a complex result to a real number', async () => {
  const generated = await generatedMath('## Complex offset\n\n$$\nx+i\n$$\n');
  assert.deepEqual(generated.functions.complexOffset({ x: 2 }), { re: 2, im: 1 });
  assert.match(generated.code, /=> number \| \{ re: number; im: number \}/);
});

test('a checked result hint provides a usable real-valued function contract', async () => {
  const generated = await generatedMath('## Gpu limit\n\n```json\n{"inputs":{"g":"real","r":"real","d":"real"},"result":"real"}\n```\n\n$$\n\\min(g,\\lceil r/d\\rceil)\n$$\n');
  assert.equal(generated.functions.gpuLimit({ g: 8, r: 3, d: 1 }), 3);
  assert.match(generated.code, /=> number;/);
  assert.doesNotMatch(generated.code, /=> number \|/);
});

test('a result hint cannot disguise complex math as a real calculation', async () => {
  await assert.rejects(generatedMath('## Complex offset\n\n```json\n{"inputs":{"x":"real"},"result":"real"}\n```\n\n$$\nx+i\n$$\n'), /complex|real/);
});

test('composed math functions preserve compiler-generated preambles', () => {
  assert.equal(examples.functions.polynomialPlusOne({ y: 5 }), 70);
  assert.match(examples.code, /preamble/);
  assert.doesNotMatch(examples.code, /import.*from '@cortex-js\/compute-engine';|evaluate\(/);
});

test('partial type hints do not change the argument order of composed functions', async () => {
  const original = await readFile(new URL('./examples.math.md', import.meta.url), 'utf8');
  const hinted = original.replace(/## Polynomial\r?\n\r?\n/, '## Polynomial\n\n```json\n{"inputs":{"x":"real"}}\n```\n\n');
  assert.notEqual(hinted, original);
  const generated = await generatedMath(hinted);
  assert.equal(generated.functions.polynomialPlusOne({ y: 5 }), 70);
});

test('energy sums keep supply losses and each source price and carbon burden', () => {
  assert.equal(impact.functions.deliveredKWh({ d: [1.8, 1] }), 2.8);
  assert.equal(impact.functions.electricityUsd({ s: [2, 1], p: [50, 20], m: [1.2, 1] }), 0.14);
  assert.equal(impact.functions.carbonKg({ s: [2, 1], c: [400, 0] }), 0.8);
});

test('the original single-source example keeps its carbon and cost totals', () => {
  assert.equal(impact.functions.deliveredKWh({ d: [1.8] }), 1.8);
  assert.equal(impact.functions.electricityUsd({ s: [2], p: [50], m: [1.2] }), 0.12);
  assert.equal(impact.functions.carbonKg({ s: [2], c: [400] }), 0.8);
});

test('matrix inputs and results retain their nested array shape', () => {
  assert.deepEqual(examples.functions.transposeMatrix({ A: [[1, 2], [3, 4]] }), [[1, 3], [2, 4]]);
  assert.match(examples.code, /"A": Array<Array<number>>/);
});

test('editing a Markdown equation changes executable TypeScript without generator edits', async () => {
  const original = await readFile(new URL('./impact.math.md', import.meta.url), 'utf8');
  const changed = original.replace('s_i p_i m_i', '2 s_i p_i m_i');
  assert.notEqual(changed, original);
  const updated = await generatedMath(changed);
  assert.equal(updated.functions.electricityUsd({ s: [2], p: [50], m: [1.2] }), 0.24);
  assert.equal(updated.functions.carbonKg({ s: [2], c: [400] }), 0.8);
});

test('a new mathematical document needs no generator-specific bindings', async () => {
  const fresh = await generatedMath('## Hypotenuse\n\n$$\n\\sqrt{u^2+v^2}\n$$\n');
  assert.equal(fresh.functions.hypotenuse({ u: 3, v: 4 }), 5);
});

test('array hints do not leak into the next function', async () => {
  const generated = await generatedMath('## Entry count\n\n```json\n{"inputs":{"x":"list<real>"}}\n```\n\n$$\n\\operatorname{Length}(x)\n$$\n\n## Offset\n\n$$\nx+1\n$$\n');
  assert.equal(generated.functions.entryCount({ x: [2, 3, 4] }), 3);
  assert.equal(generated.functions.offset({ x: 4 }), 5);
});

test('each math block is a function body rather than a root lambda', async () => {
  await assert.rejects(generatedMath('## Square\n\n$$\nx \\mapsto x^2\n$$\n'), /expression body/);
});

test('an unfinished math block cannot silently disappear from generation', async () => {
  const source = await readFile(new URL('./examples.math.md', import.meta.url), 'utf8');
  await assert.rejects(generatedMath(source + '\n$$\nx + 1\n'), /incomplete math block/);
});

test('unused JSON hints cannot silently disappear from generation', async () => {
  const source = await readFile(new URL('./examples.math.md', import.meta.url), 'utf8');
  await assert.rejects(generatedMath(source + '\n```json\n{"inputs":{"q":"real"}}\n```\n'), /hints without math/);
});

test('duplicate and reserved exports fail during generation', async () => {
  const source = '```json\n{"name":"runtime","inputs":{"x":"real"}}\n```\n\n$$\nx+1\n$$\n';
  await assert.rejects(generatedMath(source), /Invalid or duplicate export name/);
  await assert.rejects(generatedMath(source.replace('runtime', 'class')), /Unexpected token/);
  const valid = source.replace('runtime', 'example');
  await assert.rejects(generatedMath(valid + valid), /Invalid or duplicate export name/);
  await assert.rejects(generatedMath('## Sin\n\n$$\nx+1\n$$\n'), /conflicts with built-in math notation/);
});

test('the CLI refuses to overwrite its mathematical source', async () => {
  const folder = await mkdtemp(fileURLToPath(new URL('./.math-test-', import.meta.url)));
  const input = path.join(folder, 'source.md');
  const source = '```json\n{"name":"example","inputs":{"x":"real"}}\n```\n\n$$\nx+1\n$$\n';
  try {
    await writeFile(input, source);
    assert.throws(() => execFileSync(process.execPath,
      [fileURLToPath(new URL('./generate.mjs', import.meta.url)), input, input],
      { stdio: 'pipe' }), /Output must differ/);
    assert.equal(await readFile(input, 'utf8'), source);
  } finally {
    await rm(input, { force: true });
    await rmdir(folder);
  }
});
