import { ApiRegionalGrid } from '../core/energy/data/ApiRegionalGrid';
import type { EiaApiSnapshot } from '../core/energy/data/eiaApi';
import type { RegionalGrid } from '../core/energy/RegionalGrid.interface';
import type { CaisoSnapshot } from '../server/caiso';
import { createFeedClient } from './createFeedClient';

/** Construct once in application assembly and pass to consumers. No global singleton. */
export function createPublicGridClient(options: { fetcher?: typeof fetch; pollMs?: number; now?: () => number } = {}) {
  const eia = createFeedClient<EiaApiSnapshot>('/api/grid/eia', options);
  const caiso = createFeedClient<CaisoSnapshot>('/api/grid/caiso', options);
  let supplied: EiaApiSnapshot | null = null;
  let grid: RegionalGrid | undefined;
  const regionalGrid: RegionalGrid = {
    read(regionId, window) {
      const snapshot = eia.getSnapshot().snapshot;
      if (snapshot !== supplied) {
        supplied = snapshot;
        grid = snapshot ? new ApiRegionalGrid(snapshot) : undefined;
      }
      return grid?.read(regionId, window) ?? { observations: [], forecast: {} };
    },
  };
  return { eia, caiso, regionalGrid };
}

export type PublicGridClient = ReturnType<typeof createPublicGridClient>;
