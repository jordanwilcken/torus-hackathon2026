import type { TimeWindow } from '../../TimeWindow.type.js';
import type { GridContext } from '../GridContext.type.js';
import type { RegionalGrid } from '../RegionalGrid.interface.js';
import type { EiaApiSnapshot } from './eiaApi.js';
import { windowBounds } from './eia930.js';

/** A synchronous view of a previously normalized API snapshot; collection happens outside this adapter. */
export class ApiRegionalGrid implements RegionalGrid {
  private readonly snapshot: EiaApiSnapshot;

  constructor(snapshot: EiaApiSnapshot) {
    this.snapshot = structuredClone(snapshot);
  }

  read(regionId: string, window: TimeWindow): GridContext {
    const [start, end] = windowBounds(window);
    if (regionId !== this.snapshot.regionId) return { observations: [], forecast: {} };
    const contains = (period: TimeWindow) => Date.parse(period.startAt) >= start && Date.parse(period.endAt) <= end;
    const observations = this.snapshot.observations.filter(observation => contains(observation.window));
    const demand = this.snapshot.forecast.demand;
    const points = demand?.points.filter(point => contains(point.window)) ?? [];
    return structuredClone({ observations, forecast: demand && points.length ? { demand: { ...demand, points } } : {} });
  }
}
