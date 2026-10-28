import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repository = fileURLToPath(new URL('../', import.meta.url));
const usage = 'Usage: node scripts/run-simulation.mjs [scenario.json] [output.json]';

function argumentsForRun(args) {
    if (args.length === 1 && args[0] === '--help') return undefined;
    if (args.length > 2 || args.some(arg => arg.startsWith('-'))) throw new Error(usage);
    return {
        input: args[0] ? path.resolve(args[0]) : path.join(repository, 'examples/replay/solar-shift.json'),
        output: args[1] ? path.resolve(args[1]) : undefined,
    };
}

function git(...args) {
    return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

async function checkNewOutput(output) {
    if (!output) return;
    if (path.extname(output).toLowerCase() !== '.json') throw new Error('Output must be a new .json file.');
    try {
        await lstat(output);
        throw new Error('Output already exists; choose a new evidence file. Existing files are never overwritten.');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const relative = path.relative(repository, output);
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
        const tracked = git('ls-files', '--', relative);
        if (tracked) throw new Error('Output is a tracked repository file; choose a new evidence file.');
    }
}

async function main() {
    const paths = argumentsForRun(process.argv.slice(2));
    if (!paths) {
        process.stdout.write(`${usage}\nRuns captured modeled fleet inputs; no hardware work or live data.\n`);
        return;
    }
    await checkNewOutput(paths.output);
    const bytes = await readFile(paths.input);
    const scenario = JSON.parse(bytes.toString('utf8'));
    const engine = { revision: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain=v1', '--untracked-files=normal') !== '' };
    const scenarioSha256 = createHash('sha256').update(bytes).digest('hex');
    const server = await createServer({
        root: repository, configFile: false, logLevel: 'error', clearScreen: false,
        // Vite's middleware mode still starts a separate websocket server unless ws is disabled.
        server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    });
    let evidence;
    try {
        const { runPairedReplay } = await server.ssrLoadModule('/src/core/execution/replay/runPairedReplay.ts');
        evidence = { ...await runPairedReplay(scenario), provenance: { scenarioSha256, engine } };
    } finally {
        await server.close();
    }
    const json = JSON.stringify(evidence, null, 2) + '\n';
    if (paths.output) {
        await mkdir(path.dirname(paths.output), { recursive: true });
        // Exclusive creation also prevents a file appearing after the earlier check from being overwritten.
        await writeFile(paths.output, json, { flag: 'wx' });
        process.stderr.write('Modeled replay evidence written.\n');
    } else {
        process.stdout.write(json);
    }
}

main().catch(error => {
    process.stderr.write(`Replay failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
