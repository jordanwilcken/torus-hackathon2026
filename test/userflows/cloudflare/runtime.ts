import { unstable_dev } from 'wrangler';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** Owns actual workerd and an isolated SQLite directory, including full process restarts. */
export async function cloudflareRuntime(port: number) {
  process.env.CLOUDFLARE_SEND_METRICS = 'false';
  process.env.WRANGLER_SEND_METRICS = 'false';
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'sunchaser-cloudflare-flow-'));
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  const start = async () => {
    worker = await unstable_dev(resolve('test/userflows/cloudflare/worker.ts'), {
      config: resolve('test/userflows/cloudflare/wrangler.jsonc'),
      ip: '127.0.0.1', port, local: true, persist: true, persistTo: directory,
      logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, showInteractiveDevSession: false, enableContainers: false },
    });
  };
  const dispose = async () => {
    await worker?.stop(); worker = undefined;
    if (dirname(directory) !== parent || !basename(directory).startsWith('sunchaser-cloudflare-flow-')) throw new Error('Refusing to remove an unowned runtime directory');
    await rm(directory, { recursive: true, force: true });
  };
  try { await start(); } catch (error) { await dispose(); throw error; }
  return { url: 'http://127.0.0.1:' + port, dispose,
    async restart() { await worker?.stop(); worker = undefined; await start(); },
  };
}
