import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const command = path.join(repository, 'scripts/run-simulation.mjs');
const sample = path.join(repository, 'examples/replay/solar-shift.json');

function run(...args) {
    return spawnSync(process.execPath, [command, ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
}

async function withDirectory(exercise) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'torus-replay-cli-'));
    try { await exercise(directory); }
    finally {
        const resolved = path.resolve(directory);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(resolved).startsWith('torus-replay-cli-'));
        await rm(resolved, { recursive: true, force: true });
    }
}

test('captured input exports identical JSON with exact input hash and engine provenance', async () => {
    const first = run();
    const second = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    const evidence = JSON.parse(first.stdout);
    assert.equal(evidence.scope, 'modeled-fleet');
    assert.equal(evidence.comparison.comparison, 'comparable');
    assert.ok(Math.abs(evidence.baseline.impact.carbonKg - 0.52) < 1e-9);
    assert.ok(Math.abs(evidence.selected.impact.carbonKg - 0.12) < 1e-9);
    assert.equal(evidence.provenance.scenarioSha256, createHash('sha256').update(await readFile(sample)).digest('hex'));
    assert.match(evidence.provenance.engine.revision, /^[0-9a-f]{40,64}$/);
    assert.equal(typeof evidence.provenance.engine.dirty, 'boolean');
});

test('an export is a new file and cannot overwrite input or existing evidence', async () => {
    await withDirectory(async directory => {
        const output = path.join(directory, 'evidence.json');
        const written = run(sample, output);
        assert.equal(written.status, 0, written.stderr);
        const before = await readFile(output, 'utf8');
        assert.equal(JSON.parse(before).scope, 'modeled-fleet');
        const repeated = run(sample, output);
        assert.notEqual(repeated.status, 0);
        assert.match(repeated.stderr, /already exists/);
        assert.equal(await readFile(output, 'utf8'), before);
        const inputBefore = await readFile(sample, 'utf8');
        const overwriteInput = run(sample, sample);
        assert.notEqual(overwriteInput.status, 0);
        assert.equal(await readFile(sample, 'utf8'), inputBefore);
    });
});

test('unfinished work is exported as noncomparable evidence with no claimed reductions', async () => {
    await withDirectory(async directory => {
        const scenario = JSON.parse(await readFile(sample, 'utf8'));
        scenario.jobs[0].workGpuH = 100;
        scenario.jobs[0].remainingGpuH = 100;
        const input = path.join(directory, 'unfinished.json');
        await writeFile(input, JSON.stringify(scenario));
        const result = run(input);
        assert.equal(result.status, 0, result.stderr);
        const evidence = JSON.parse(result.stdout);
        assert.equal(evidence.comparison.comparison, 'not-comparable');
        assert.deepEqual(evidence.reductions, { carbonKg: null, modeledCostUsd: null });
    });
});

test('invalid arguments and malformed input fail clearly without successful evidence', async () => {
    const usageError = run('--unknown');
    assert.notEqual(usageError.status, 0);
    assert.match(usageError.stderr, /Usage:/);
    assert.equal(usageError.stdout, '');
    await withDirectory(async directory => {
        const input = path.join(directory, 'invalid.json');
        await writeFile(input, '{');
        const invalidJson = run(input);
        assert.notEqual(invalidJson.status, 0);
        assert.match(invalidJson.stderr, /Replay failed:/);
        assert.equal(invalidJson.stdout, '');
    });
});

test('headless replay does not start an HTTP or websocket listener', async () => {
    await withDirectory(async directory => {
        const preload = path.join(directory, 'reject-listener.mjs');
        await writeFile(preload, `import { Server } from 'node:net';
Server.prototype.listen = function () { throw new Error('Headless replay attempted a network listener.'); };
`);
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, command], {
            cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).comparison.comparison, 'comparable');
    });
});
