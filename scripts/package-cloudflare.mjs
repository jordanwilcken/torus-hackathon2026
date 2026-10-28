import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, appendFile, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicPath, deploymentConfig, listFiles, sha256, verifyCloudflarePackage } from './verify-cloudflare-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache/cloudflare');
const args = process.argv.slice(2);
let allowDirty = false;
let destination = join(cache, 'release');
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--allow-dirty') allowDirty = true;
  else if (args[index] === '--outdir' && args[index + 1]) destination = resolve(root, args[++index]);
  else throw new Error('Usage: package-cloudflare.mjs [--allow-dirty] [--outdir .cache/cloudflare/NAME]');
}
if (process.env.CI && allowDirty) throw new Error('CI cannot package uncommitted source.');
if (!/^v24\./.test(process.version) || Number(process.versions.node.split('.')[1]) < 19) throw new Error('Use pinned Node 24.19 or later in the Node24 line.');
const inside = relative(cache, destination);
if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Package output must be a child of .cache/cloudflare.');
try { await access(destination); throw new Error('Package output already exists; choose a new owned output directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
function run(command, commandArgs, capture = false) {
  const result = spawnSync(command, commandArgs, { cwd: root, shell: false, windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(command + ' failed (' + result.status + ').', { cause: result.error });
  return result.stdout?.trim() ?? '';
}
const commit = run('git', ['rev-parse', 'HEAD'], true);
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) throw new Error('Checkout differs from the workflow commit.');
const dirtyBefore = Boolean(run('git', ['status', '--porcelain'], true));
if (dirtyBefore && !allowDirty) throw new Error('Commit reviewed changes before packaging; --allow-dirty is local validation only.');
const sourceConfig = await readFile(join(root, 'wrangler.jsonc'));
const config = deploymentConfig(JSON.parse(sourceConfig));
const packageLock = await readFile(join(root, 'package-lock.json'));
const installedWrangler = JSON.parse(await readFile(join(root, 'node_modules/wrangler/package.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (installedWrangler.version !== packageJson.devDependencies.wrangler) throw new Error('Installed Wrangler differs from the exact repository pin.');
await mkdir(cache, { recursive: true });
const staging = await mkdtemp(join(cache, 'stage-'));
const bundle = await mkdtemp(join(cache, 'bundle-'));
async function copyPublicTree(source, target, prefix) {
  const information = await lstat(source);
  if (!information.isDirectory() || information.isSymbolicLink()) throw new Error('Built assets must be a regular directory.');
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const path = prefix + '/' + entry.name;
    assertPublicPath(path);
    if (entry.isSymbolicLink()) throw new Error('Symlink in built assets: ' + path);
    if (entry.isDirectory()) await copyPublicTree(join(source, entry.name), join(target, entry.name), path);
    else if (entry.isFile()) await copyFile(join(source, entry.name), join(target, entry.name));
    else throw new Error('Unsupported built asset: ' + path);
  }
}
async function removeOwned(path) {
  if (dirname(path) !== cache || !/^(stage|bundle)-/.test(basename(path))) throw new Error('Refusing to remove an unowned packaging directory.');
  await rm(path, { recursive: true, force: true });
}
try {
  // No UI rebuild: package the dist that the workflow already built.
  run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outdir', bundle]);
  const outputs = await readdir(bundle);
  if (!outputs.includes('worker.js') || outputs.some(name => !['worker.js', 'worker.js.map', 'README.md'].includes(name))) {
    throw new Error('Unexpected Wrangler bundle modules; review the package allowlist.');
  }
  await mkdir(join(staging, 'bundle'));
  await copyFile(join(bundle, 'worker.js'), join(staging, 'bundle/worker.js'));
  await copyPublicTree(join(root, 'dist'), join(staging, 'dist'), 'dist');
  await writeFile(join(staging, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  const dirty = dirtyBefore || Boolean(run('git', ['status', '--porcelain'], true));
  if (run('git', ['rev-parse', 'HEAD'], true) !== commit || (dirty && !allowDirty)) throw new Error('Source changed during packaging.');
  const files = Object.create(null);
  for (const path of await listFiles(staging)) files[path] = sha256(await readFile(join(staging, path)));
  const manifest = {
    schemaVersion: 1, commit, dirty, node: process.version, wranglerVersion: installedWrangler.version,
    sourceConfigSha256: sha256(sourceConfig), packageLockSha256: sha256(packageLock),
    contentHash: sha256(JSON.stringify(files)), files,
  };
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  const manifestSha256 = sha256(manifestBytes);
  await writeFile(join(staging, 'release.json'), manifestBytes);
  await verifyCloudflarePackage(staging, { commit, manifestSha256, allowDirty });
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  for (const path of await listFiles(staging)) {
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await copyFile(join(staging, path), join(destination, path), constants.COPYFILE_EXCL);
  }
  await verifyCloudflarePackage(destination, { commit, manifestSha256, allowDirty });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    'manifest_sha256=' + manifestSha256 + '\ncommit=' + commit + '\ncontent_hash=' + manifest.contentHash + '\n');
  console.log(JSON.stringify({ directory: destination, commit, dirty, manifestSha256, contentHash: manifest.contentHash, files: Object.keys(files).length }, null, 2));
} finally {
  await removeOwned(staging);
  await removeOwned(bundle);
}
