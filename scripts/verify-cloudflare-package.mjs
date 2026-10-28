import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = content => createHash('sha256').update(content).digest('hex');
const sourceKeys = ['$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev',
  'assets', 'durable_objects', 'migrations', 'observability'];

/** Preserve the reviewed deployment settings, with only portable artifact paths changed. */
export function deploymentConfig(source) {
  if (!source || typeof source !== 'object' || Object.keys(source).some(key => !sourceKeys.includes(key))) {
    throw new Error('Unsupported deployment configuration; review before packaging.');
  }
  if (source.main !== 'src/cloudflare/worker.ts' || source.assets?.directory !== './dist'
    || source.assets?.binding !== 'ASSETS' || source.assets?.run_worker_first !== true
    || source.durable_objects?.bindings?.length !== 1
    || source.durable_objects.bindings[0].name !== 'DEMO'
    || source.durable_objects.bindings[0].class_name !== 'Demo'
    || !source.migrations?.some(migration => migration.new_sqlite_classes?.includes('Demo'))) {
    throw new Error('Unexpected production entry, authenticated assets or SQLite Durable Object configuration.');
  }
  const { $schema: _schema, ...settings } = source;
  return { ...settings, main: './bundle/worker.js', base_dir: './bundle', no_bundle: true, assets: { ...source.assets, directory: './dist' } };
}

export function assertPublicPath(path) {
  const parts = path.split('/');
  if (!path || path.includes('\\') || path.includes(':') || parts.some(part => !part || part === '..' || part.startsWith('.')
    || /\.(pem|key|sqlite|sqlite-wal|sqlite-shm|env)$/i.test(part)
    || ['node_modules', 'runtime.env', 'test', 'tests'].includes(part))) {
    throw new Error('Private or invalid artifact path: ' + path);
  }
}

export async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    assertPublicPath(relative);
    if (entry.isSymbolicLink()) throw new Error('Symlink in artifact: ' + relative);
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Unsupported artifact entry: ' + relative);
  }
  return files.sort();
}

export async function verifyCloudflarePackage(directory, { commit, manifestSha256, allowDirty = false }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? '')) {
    throw new Error('A full expected commit SHA and trusted manifest SHA-256 are required.');
  }
  if (process.env.CI && allowDirty) throw new Error('CI cannot accept an uncommitted package.');
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Artifact root must be a regular directory.');
  const manifestBytes = await readFile(join(root, 'release.json'));
  if (sha256(manifestBytes) !== manifestSha256) throw new Error('Release manifest checksum mismatch.');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.commit !== commit || typeof manifest.dirty !== 'boolean'
    || (manifest.dirty && !allowDirty) || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Release provenance does not match the approved commit or is uncommitted.');
  }
  const actualFiles = await listFiles(root);
  const expectedFiles = [...Object.keys(manifest.files), 'release.json'].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('Artifact contains missing or unexpected files.');
  if (!manifest.files['bundle/worker.js'] || !manifest.files['wrangler.json'] || !manifest.files['dist/index.html']) {
    throw new Error('Artifact is missing the production worker, configuration or built UI.');
  }
  for (const path of Object.keys(manifest.files).sort()) {
    assertPublicPath(path);
    if (!['bundle/worker.js', 'wrangler.json'].includes(path) && !path.startsWith('dist/')) {
      throw new Error('Unexpected deployable artifact file: ' + path);
    }
    if (!/^[a-f0-9]{64}$/.test(manifest.files[path]) || sha256(await readFile(join(root, path))) !== manifest.files[path]) {
      throw new Error('Artifact file checksum mismatch: ' + path);
    }
  }
  if (sha256(JSON.stringify(manifest.files)) !== manifest.contentHash) throw new Error('Artifact content manifest is inconsistent.');
  const sourceConfig = await readFile(join(repository, 'wrangler.jsonc'));
  const lock = await readFile(join(repository, 'package-lock.json'));
  if (sha256(sourceConfig) !== manifest.sourceConfigSha256 || sha256(lock) !== manifest.packageLockSha256) {
    throw new Error('Checked-out deployment configuration or dependency lock differs from the packaged source.');
  }
  const installedWrangler = JSON.parse(await readFile(join(repository, 'node_modules/wrangler/package.json'), 'utf8'));
  if (installedWrangler.version !== manifest.wranglerVersion) throw new Error('Use the same pinned Wrangler version as the tested artifact.');
  const config = JSON.parse(await readFile(join(root, 'wrangler.json'), 'utf8'));
  if (JSON.stringify(config) !== JSON.stringify(deploymentConfig(JSON.parse(sourceConfig)))) {
    throw new Error('Portable deployment configuration differs from the reviewed source.');
  }
  return { directory: root, commit, dirty: manifest.dirty, manifestSha256, contentHash: manifest.contentHash, files: actualFiles.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const directory = args.shift();
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--commit' && args[index + 1]) options.commit = args[++index];
    else if (args[index] === '--manifest-sha256' && args[index + 1]) options.manifestSha256 = args[++index];
    else if (args[index] === '--allow-dirty') options.allowDirty = true;
    else throw new Error('Usage: verify-cloudflare-package.mjs DIRECTORY --commit SHA --manifest-sha256 SHA256 [--allow-dirty]');
  }
  if (!directory) throw new Error('Artifact directory is required.');
  console.log(JSON.stringify(await verifyCloudflarePackage(directory, options), null, 2));
}
