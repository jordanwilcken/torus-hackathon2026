import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const cliIndex = args.indexOf('--npm-cli');
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--allow-dirty') continue;
  if (args[index] === '--npm-cli' && args[index + 1]) { index++; continue; }
  throw new Error('Usage: node scripts/package-demo.mjs [--allow-dirty] [--npm-cli /path/to/npm-cli.js]');
}
const nodeBin = dirname(process.execPath);
const npmCandidates = [cliIndex >= 0 ? args[cliIndex + 1] : undefined, process.env.npm_execpath,
  join(nodeBin, 'node_modules/npm/bin/npm-cli.js'), join(nodeBin, '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
let npmCli;
for (const candidate of npmCandidates) { try { await access(candidate, constants.R_OK); npmCli = candidate; break; } catch {} }
if (!npmCli) throw new Error('Pass --npm-cli with the npm-cli.js installed beside your pinned Node runtime.');
if (!/^v24\./.test(process.version) || Number(process.versions.node.split('.')[1]) < 19) throw new Error('Use Node 24.19.0 or later in the Node24 line.');
function run(command, commandArgs, capture = false) {
  const result = spawnSync(command, commandArgs, { cwd: root, shell: false, encoding: 'utf8',
    env: { ...process.env, PATH: `${nodeBin}${delimiter}${process.env.PATH ?? ''}` }, stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? 'not started'}).`, { cause: result.error });
  return result.stdout?.trim() ?? '';
}
const commit = run('git', ['rev-parse', 'HEAD'], true);
if (!allowDirty && run('git', ['status', '--porcelain'], true)) throw new Error('Commit reviewed changes first. --allow-dirty is only for local packaging checks, not a published release.');
run(process.execPath, [npmCli, 'run', 'build']);
const dirty = !!run('git', ['status', '--porcelain'], true);
if (dirty && !allowDirty) throw new Error('Build changed tracked files. Review and commit generated changes before packaging.');
const output = join(root, '.cache/deploy');
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, 'stage-'));
const files = {};
async function copyAllowed(relative) {
  const path = join(root, relative);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not permitted in releases: ${relative}`);
  const name = relative.split('/').at(-1);
  if (name.startsWith('.env') || /\.(pem|key|sqlite|sqlite-wal|sqlite-shm)$/i.test(name)
    || ['node_modules', '.cache', '.git', 'test'].includes(name)) throw new Error(`Private or non-runtime file in release inputs: ${relative}`);
  if (info.isDirectory()) {
    await mkdir(join(staging, relative), { recursive: true });
    for (const entry of (await readdir(path)).sort()) await copyAllowed(`${relative}/${entry}`);
  } else if (info.isFile()) {
    await mkdir(dirname(join(staging, relative)), { recursive: true });
    const original = await readFile(path);
    const content = relative.startsWith('deploy/') ? Buffer.from(original.toString('utf8').replaceAll('\r\n', '\n')) : original;
    await writeFile(join(staging, relative), content);
    files[relative] = createHash('sha256').update(content).digest('hex');
  } else throw new Error(`Unsupported release file: ${relative}`);
}
try {
  for (const path of ['dist', 'src', 'package.json', 'package-lock.json', 'deploy/install.sh', 'deploy/sunchaser.service', 'deploy/runtime.env.example', 'deploy/README.md']) await copyAllowed(path);
  if (!files['src/server/start.ts'] || !files['src/server/jobs/localWorkerProcess.mjs'] || !files['dist/index.html']) throw new Error('Release must contain built UI, production entry point and real worker process.');
  const contentHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const name = `sunchaser-${commit.slice(0, 12)}-${contentHash.slice(0, 12)}${dirty ? '-uncommitted' : ''}.tar.gz`;
  await writeFile(join(staging, 'release.json'), `${JSON.stringify({ commit, dirty, node: process.version, contentHash, files }, null, 2)}\n`);
  const archive = join(output, name);
  try { await access(archive); throw new Error(`Release already exists: ${archive}. Preserve the original artifact or remove that owned local test artifact explicitly before rebuilding.`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  run('tar', ['-czf', archive, '-C', staging, '.']);
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${sha256}  ${name}\n`);
  console.log(JSON.stringify({ archive, sha256, commit, dirty, files: Object.keys(files).length }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
