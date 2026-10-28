import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ComputeEngine, compile } from '@cortex-js/compute-engine';

function typescript(type) {
  if (typeof type === 'string') {
    if (['real', 'rational', 'integer', 'signed_infinity', 'nan'].includes(type)) return 'number';
    if (['number', 'complex', 'imaginary', 'infinity'].includes(type))
      return 'number | { re: number; im: number }';
    if (['boolean', 'string', 'unknown', 'never'].includes(type)) return type;
    return 'unknown';
  }
  if (type.kind === 'numeric') return typescript(type.type);
  if (type.kind === 'value') return typeof type.value === 'number' ? 'number' : 'unknown';
  if (type.kind === 'union') return [...new Set(type.types.map(typescript))].join(' | ');
  if (type.kind === 'list') {
    if (type.dimensions === null) return 'unknown';
    return Array.from({ length: type.dimensions?.length ?? 1 })
      .reduce((element) => `Array<${element}>`, typescript(type.elements));
  }
  if (type.kind === 'tuple') return `[${type.elements.map((entry) => typescript(entry.type)).join(', ')}]`;
  return 'unknown';
}

function identifier(label) {
  return label.trim().replace(/`/g, '').replace(/[^A-Za-z0-9_$]+(.)?/g,
    (_, next) => next ? next.toUpperCase() : '').replace(/^[A-Z]/, (first) => first.toLowerCase());
}

function mathBlocks(markdown, input) {
  const tokens = [...markdown.matchAll(/^#{1,6}[ \t]+(.+)$|^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$|^\$\$[ \t]*\r?\n([\s\S]*?)^\$\$[ \t]*$/gm)];
  const blocks = [];
  let heading, hints;
  for (const [, title, json, latex] of tokens) {
    if (title !== undefined) {
      if (hints !== undefined) throw new Error(`${input}: JSON hints must be followed by a math block`);
      heading = title.replace(/\s+#+\s*$/, '');
    } else if (json !== undefined) {
      if (hints !== undefined) throw new Error(`${input}: JSON hints must be followed by a math block`);
      hints = JSON.parse(json);
    } else {
      const name = hints?.name ?? identifier(heading ?? basename(input).replace(/(?:\.math)?\.md$/, ''));
      blocks.push({ name, inputs: hints?.inputs ?? {}, resultType: hints?.result, latex });
      hints = undefined;
    }
  }
  const declarations = [...markdown.matchAll(/^```json[ \t]*$/gm)].length;
  const delimiters = [...markdown.matchAll(/^\$\$[ \t]*$/gm)].length;
  if (hints !== undefined || !blocks.length || blocks.length * 2 !== delimiters ||
      declarations !== tokens.filter((token) => token[2] !== undefined).length)
    throw new Error(`${input}: incomplete math block or JSON hints without math`);
  return blocks;
}

async function generate(input, output) {
  const ce = new ComputeEngine();
  const markdown = await readFile(input, 'utf8');
  const blocks = mathBlocks(markdown, input);
  const names = new Set(['runtime', 'createJavaScriptRuntime', 'StoredJavaScript']);

  const exports = blocks.map(({ name, inputs, resultType, latex }) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate export name: ${name}`);
    new Function(`"use strict"; return async (${name}) => {};`);
    names.add(name);
    ce.pushScope();
    for (const [symbol, type] of Object.entries(inputs)) ce.declare(symbol, type);
    let expression = ce.parse(latex);
    if (resultType) expression = ce.box(['Typed', expression.json, { str: resultType }]);
    if (!expression.isValid) throw new Error(`${input}: invalid math for ${name}`);
    const result = compile(expression, { to: 'javascript', mode: 'strict', fallback: false });
    if (result.calling === 'lambda') throw new Error(`${name}: supply the expression body; parameters are inferred or hinted`);
    const symbols = result.freeSymbols.toSorted();

    const parameters = symbols.map((symbol) => {
      const lowered = result.freeSymbolTypes?.[symbol]?.lowered;
      let type = typescript(ce.box(symbol).type.type);
      if (['number', 'boolean', 'string'].includes(lowered)) type = lowered;
      else if (lowered === 'array' && type === 'unknown') type = 'unknown[]';
      return `${JSON.stringify(symbol)}: ${type}`;
    }).join('; ');
    const inputTypes = symbols.map((symbol) => result.freeSymbolTypes?.[symbol]?.type ?? `${ce.box(symbol).type}`);
    const returnType = typescript(expression.type.type);
    const artifact = Object.fromEntries([
      'code', 'preamble', 'preambleOnce', 'preamblePerCall', 'callCode', 'calling',
      'reconstructionDigits', 'entryPlan', 'runtimeVersion', 'valueKinds',
    ].filter((key) => result[key] !== undefined).map((key) => [key, result[key]]));

    ce.popScope();
    ce.declare(name, { signature: `(${inputTypes.join(', ')}) -> ${expression.type}` });
    ce.assign(name, ce.box(['Function', expression.json, ...symbols]));
    const call = ce.parse(`\\operatorname{${name}}(0)`, { canonical: false }).json;
    if (!Array.isArray(call) || call[0] !== name) throw new Error(`${name}: export name conflicts with built-in math notation`);
    return `export const ${name} = runtime.load(${JSON.stringify(artifact, null, 2)} satisfies StoredJavaScript) as\n  (input: { ${parameters} }) => ${returnType};`;
  });

  await writeFile(output, `// Generated from ${basename(input)}. Edit the math source and regenerate.
import { createJavaScriptRuntime, type StoredJavaScript } from '@cortex-js/compute-engine/runtime';

const runtime = createJavaScriptRuntime();

${exports.join('\n\n')}
`);
  console.log(`Generated ${exports.length} functions: ${input} -> ${output}`);
}

const [input, output] = process.argv.slice(2);
const sources = input ? [input] : (await readdir('.')).filter((file) => file.endsWith('.math.md')).sort();
for (const source of sources) {
  const target = output ?? source.replace(/(?:\.math)?\.md$/, '') + '.generated.ts';
  if (resolve(source).toLowerCase() === resolve(target).toLowerCase()) throw new Error('Output must differ from the math source');
  await generate(source, target);
}
