/**
 * Markdown block discovery and strict Cortex compilation adapted from
 * examples/math-formula-proof/generate.mjs (Sunchaser, @cortex-js/compute-engine 0.171.0).
 * This local emitter accepts explicitly declared scalar real inputs and real results.
 * It preserves the compiler expression unchanged and refuses preambles/runtime helpers.
 * Generated functions accept prepared numeric scalars; callers validate inputs and reject nonfinite calculated results.
 * The application imports only generated JS; Cortex is a development dependency here.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ComputeEngine, compile } from '@cortex-js/compute-engine';

const compilerVersion = '0.171.0';
const installed = JSON.parse(await readFile(new URL('../../package.json',
  import.meta.resolve('@cortex-js/compute-engine')), 'utf8'));
if (installed.version !== compilerVersion)
  throw new Error('Use the locked Cortex compiler ' + compilerVersion + '.');

function identifier(label) {
  return label.trim().replace(/\x60/g, '').replace(/[^A-Za-z0-9_$]+(.)?/g,
    (_, next) => next ? next.toUpperCase() : '').replace(/^[A-Z]/, first => first.toLowerCase());
}

function mathBlocks(markdown, sourceName) {
  const tokens = [...markdown.matchAll(/^#{1,6}[ \t]+(.+)$|^\x60{3}json[ \t]*\r?\n([\s\S]*?)^\x60{3}[ \t]*$|^\$\$[ \t]*\r?\n([\s\S]*?)^\$\$[ \t]*$/gm)];
  const blocks = [];
  let heading, hints;
  for (const [, title, json, latex] of tokens) {
    if (title !== undefined) {
      if (hints !== undefined) throw new Error('JSON hints must be followed by a math block.');
      heading = title.replace(/\s+#+\s*$/, '');
    } else if (json !== undefined) {
      if (hints !== undefined) throw new Error('JSON hints must be followed by a math block.');
      hints = JSON.parse(json);
    } else {
      if (!hints || typeof hints !== 'object' || Array.isArray(hints) ||
          !hints.inputs || typeof hints.inputs !== 'object' || Array.isArray(hints.inputs) ||
          hints.result !== 'real' ||
          Object.keys(hints).some(key => !['name', 'inputs', 'result'].includes(key)))
        throw new Error('Each equation requires JSON inputs and result: real.');
      const inputs = Object.entries(hints.inputs).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      if (inputs.some(([name, type]) => !/^[A-Za-z_$][\w$]*$/.test(name) || type !== 'real'))
        throw new Error('Inputs must be explicitly named scalar real values.');
      const name = hints.name ?? identifier(heading ?? basename(sourceName).replace(/(?:\.math)?\.md$/, ''));
      blocks.push({ name, inputs, latex });
      hints = undefined;
    }
  }
  const declarations = [...markdown.matchAll(/^\x60{3}json[ \t]*$/gm)].length;
  const delimiters = [...markdown.matchAll(/^\$\$[ \t]*$/gm)].length;
  if (hints !== undefined || !blocks.length || blocks.length * 2 !== delimiters ||
      declarations !== tokens.filter(token => token[2] !== undefined).length)
    throw new Error('Incomplete math block or JSON hints without math.');
  return blocks;
}

/** Compile the supported Markdown subset to a deterministic standalone ES module. */
export function compileMath(markdown, sourceName) {
  markdown = markdown.replace(/\r\n/g, '\n');
  const names = new Set(['Math', 'Number', 'NaN', 'Infinity', 'undefined']);
  const functions = mathBlocks(markdown, sourceName).map(({ name, inputs, latex }) => {
    if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name) || names.has(name))
      throw new Error('Invalid, reserved or duplicate export name: ' + name);
    new Function('"use strict"; return function ' + name + '() {};');
    names.add(name);

    const engine = new ComputeEngine();
    for (const [symbol] of inputs) engine.declare(symbol, 'real');
    const parsed = engine.parse(latex);
    if (!parsed.isValid) throw new Error('Invalid math for ' + name + '.');
    const expression = engine.box(['Typed', parsed.json, { str: 'real' }]);
    const compilation = compile(expression, { to: 'javascript', mode: 'strict', fallback: false });
    if (!compilation.success || compilation.target !== 'javascript' || compilation.calling !== 'expression')
      throw new Error(name + ': only compiled real expression bodies are supported.');
    if ([compilation.preamble, compilation.preambleOnce, compilation.preamblePerCall, compilation.callCode].some(Boolean) ||
        compilation.valueKinds?.length || /\b(?:_SYS|_IA|_CE|_INTERPRETER)\b/.test(compilation.code))
      throw new Error(name + ': runtime helpers and preambles are outside the standalone scalar subset.');
    const symbols = [...(compilation.freeSymbols ?? [])].sort();
    if (JSON.stringify(symbols) !== JSON.stringify(inputs.map(([symbol]) => symbol)))
      throw new Error(name + ': every free input must be declared, with no unused input hints. Declared: ' + inputs.map(([symbol]) => symbol).join(', ') + '; compiled: ' + symbols.join(', ') + '.');

    const properties = inputs.map(([symbol]) => JSON.stringify(symbol) + ': number').join(', ');
    return [
      '/**',
      ' * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.',
      ' * @param {{ ' + properties + ' }} input',
      ' * @returns {number}',
      ' */',
      'export function ' + name + '(input) {',
      '  const _ = input;',
      '  return ' + compilation.code + ';',
      '}',
    ].join('\n');
  });
  const digest = createHash('sha256').update(markdown, 'utf8').digest('hex');
  return [
    '// Generated from ' + basename(sourceName) + '. Edit the Markdown and regenerate.',
    '// Compiler: @cortex-js/compute-engine ' + compilerVersion + '; strict scalar JavaScript.',
    '// Source SHA-256: ' + digest,
    '',
    functions.join('\n\n'),
    '',
  ].join('\n');
}

async function main(args) {
  const check = args.includes('--check');
  const paths = args.filter(argument => argument !== '--check');
  if (paths.length > 2 || paths.some(argument => argument.startsWith('--')))
    throw new Error('Usage: node generate.mjs [input.math.md [output.generated.js]] [--check]');
  const source = paths[0] ? resolve(paths[0]) : fileURLToPath(new URL('./siteEnergy.math.md', import.meta.url));
  const target = paths[1] ? resolve(paths[1]) : paths[0]
    ? source.replace(/(?:\.math)?\.md$/, '') + '.generated.js'
    : fileURLToPath(new URL('./siteEnergy.generated.js', import.meta.url));
  const compare = path => process.platform === 'win32' ? path.toLowerCase() : path;
  if (compare(source) === compare(target)) throw new Error('Output must differ from the math source.');
  if (!target.endsWith('.js')) throw new Error('The standalone output must have a .js extension.');
  const artifact = compileMath(await readFile(source, 'utf8'), basename(source));
  if (check) {
    let current;
    try { current = await readFile(target, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error('Generated JavaScript is missing. Regenerate ' + basename(source) + '.');
    }
    if (current.replace(/\r\n/g, '\n') !== artifact) throw new Error('Generated JavaScript is stale. Regenerate ' + basename(source) + '.');
    process.stdout.write('Generated JavaScript is current.\n');
  } else {
    await writeFile(target, artifact, 'utf8');
    process.stdout.write('Generated standalone JavaScript: ' + target + '\n');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}