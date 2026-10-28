import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { startProductionServer } from '../../../src/server/productionServer.ts';
import type { EiaApiSnapshot } from '../../../src/core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from '../../../src/server/caiso.ts';
import type { StoredSnapshot } from '../../../src/server/SnapshotStore.type.ts';
import eia from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import caiso from '../../fixtures/public-grid/caiso.json' with { type: 'json' };
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };

/** Playwright owns one real Node child; IPC allows graceful cleanup on Windows too. */
export default async function startHostedFlows() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true,
  });
  const stop = async () => {
    if (!child.pid || child.exitCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Production test server did not stop cleanly.')); }, 20_000);
      child.once('exit', code => {
        clearTimeout(timeout);
        if (code === 0) resolve(); else reject(new Error('Production test server exited unsuccessfully.'));
      });
      child.send('stop');
    });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Production test server did not become ready.')), 30_000);
      const failed = () => { clearTimeout(timeout); reject(new Error('Production test server exited before readiness.')); };
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', failed);
      child.once('message', message => {
        clearTimeout(timeout);
        child.off('exit', failed);
        if (message === 'ready') resolve(); else reject(new Error('Unexpected production test server readiness response.'));
      });
    });
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
  return stop;
}

async function serve() {
  // Source captures keep their original timestamps. Only the worker executes now.
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'sunchaser-hosting-flow-'));
  let server: Awaited<ReturnType<typeof startProductionServer>> | undefined;
  let closing: Promise<void> | undefined;
  async function close() {
    return closing ??= (async () => {
      await server?.close();
      // Delete only this process's fresh, verified child of the temporary directory.
      if (dirname(directory) !== temporaryRoot || !basename(directory).startsWith('sunchaser-hosting-flow-')) {
        throw new Error('Refusing to remove a directory outside this test server ownership.');
      }
      await rm(directory, { recursive: true, force: true });
    })();
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
    });
  }

  try {
    server = await startProductionServer({
      application: {
        apiKey: '', archiveDirectory: join(directory, 'grid'), runDirectory: join(directory, 'jobs'),
        recorded: { asOf: manifest.asOf, eia: eia as StoredSnapshot<EiaApiSnapshot>, caiso: caiso as StoredSnapshot<CaisoSnapshot> },
      },
      distDirectory: 'dist', publicOrigin: 'http://127.0.0.1:4177',
      username: 'judge', password: 'synthetic-hosting-test-password', host: '127.0.0.1', port: 4177,
    });
    process.once('message', message => {
      if (message === 'stop') void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
    });
    process.send?.('ready');
  } catch (error) {
    await close();
    throw error;
  }

}

if (process.argv.includes('--serve')) await serve();
