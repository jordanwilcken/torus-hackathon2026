import type { RegionalGrid } from '../RegionalGrid.interface.js';
import type { GridContext } from '../GridContext.type.js';
import type { GridObservation } from '../GridObservation.interface.js';
import type { TimeWindow } from '../../TimeWindow.type.js';
import { EIA930_BASIS, observationsFromSnapshot, parseEia930Snapshot, windowBounds } from './eia930.js';
import type { Eia930Snapshot } from './eia930.js';

const HOUR = 3_600_000;
const METRICS = ['consumption-carbon-intensity', 'demand', 'generation', 'interchange'] as const;

export class SnapshotRegionalGrid implements RegionalGrid {
  private readonly hours = new Map<string, Map<number, GridObservation[]>>();
  private readonly coverage = new Map<string, [number, number][]>();

  constructor(snapshots: Eia930Snapshot[]) {
    for (const input of snapshots) {
      const snapshot = parseEia930Snapshot(input);
      const regionHours = this.hours.get(snapshot.regionId) ?? new Map<number, GridObservation[]>();
      const periods = this.coverage.get(snapshot.regionId) ?? [];
      periods.push(windowBounds(snapshot.coverage));
      this.coverage.set(snapshot.regionId, periods);
      for (const observation of observationsFromSnapshot(snapshot)) {
        const end = Date.parse(observation.window.endAt);
        const observations = regionHours.get(end) ?? [];
        if (observations.some(o => o.metric === observation.metric)) throw new Error(`Overlapping snapshot evidence for ${snapshot.regionId} at ${observation.observedAt}`);
        observations.push(observation);
        regionHours.set(end, observations);
      }
      this.hours.set(snapshot.regionId, regionHours);
    }
  }

  read(regionId: string, window: TimeWindow): GridContext {
    const [start, end] = windowBounds(window);
    const observations: GridObservation[] = [];
    for (let hourStart = Math.ceil(start / HOUR) * HOUR; hourStart + HOUR <= end; hourStart += HOUR) {
      const hourEnd = hourStart + HOUR;
      const available = this.hours.get(regionId)?.get(hourEnd);
      if (available) {
        observations.push(...available.map(o => ({ ...o, window: { ...o.window } })));
        continue;
      }
      const periods = this.coverage.get(regionId);
      const reason = !periods ? `unknown region ${regionId}` : periods.some(([from, to]) => hourStart >= from && hourEnd <= to) ? 'missing hour in snapshot' : 'outside snapshot coverage';
      // Missing evidence must not introduce a second accounting basis for the same metric.
      for (const metric of METRICS) {
        observations.push({ regionId, metric, basis: EIA930_BASIS[metric], value: null, unit: metric === 'consumption-carbon-intensity' ? 'gCO2/kWh' : 'MW', window: { startAt: new Date(hourStart).toISOString(), endAt: new Date(hourEnd).toISOString() }, observedAt: new Date(hourEnd).toISOString(), simulated: false, source: `unavailable: ${reason}` });
      }
    }
    return { observations, forecast: {} };
  }
}
