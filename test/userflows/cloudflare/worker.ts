import { createDemoRuntime } from '../../../src/cloudflare/runtime.ts';
import { createDurableSnapshotStore } from '../../../src/cloudflare/stores.ts';
import type { SqliteStorage } from '../../../src/cloudflare/storage.types.ts';
import { createRecordedGridFeeds } from '../../../src/server/gridFeeds.ts';
import { parseEiaApiResponse } from '../../../src/core/energy/data/eiaApi.ts';
import { parseCaisoCsv } from '../../../src/server/caiso.ts';
import { snapshotRevision } from '../../../src/server/snapshotRevision.ts';
import eia from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import caiso from '../../fixtures/public-grid/caiso.json' with { type: 'json' };
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };
export { default } from '../../../src/cloudflare/worker.ts';

// Test entry only: production never bundles these captures or historical clock.
export class Demo {
  private readonly ready: Promise<ReturnType<typeof createDemoRuntime>>;
  constructor(ctx: { storage: SqliteStorage; waitUntil(promise: Promise<void>): void; blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> }) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const stores = { eia: createDurableSnapshotStore<ReturnType<typeof parseEiaApiResponse>>(ctx.storage, 'eia'), caiso: createDurableSnapshotStore<ReturnType<typeof parseCaisoCsv>>(ctx.storage, 'caiso') };
      const eiaSnapshot = parseEiaApiResponse({ response: eia.evidence.body.response }, eia.evidence.body.retrievedAt);
      const caisoSnapshot = parseCaisoCsv(caiso.evidence.body.csv, caiso.evidence.body.retrievedAt);
      if (snapshotRevision(eiaSnapshot) !== eia.revision || snapshotRevision(caisoSnapshot) !== caiso.revision) throw new Error('Captured inputs did not reproduce their original revisions');
      await stores.eia.save(eiaSnapshot, eia.evidence);
      await stores.caiso.save(caisoSnapshot, caiso.evidence);
      return createDemoRuntime(ctx.storage, { apiKey: '', feeds: createRecordedGridFeeds(stores), recordedAsOf: manifest.asOf, waitUntil: promise => ctx.waitUntil(promise) });
    });
  }
  async fetch(request: Request): Promise<Response> { return (await this.ready).fetch(request); }
}
