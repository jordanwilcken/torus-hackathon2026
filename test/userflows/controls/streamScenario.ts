import type { Job } from '../../../src/core/jobs/Job.type';
import type { EnergyMap } from '../../../src/core/energy/EnergyMap.interface';
import type { SiteEnergy } from '../../../src/core/energy/SiteEnergy.interface';
import type { RegionalGrid } from '../../../src/core/energy/RegionalGrid.interface';
import type { GridContext } from '../../../src/core/energy/GridContext.type';
import type { SlotSnapshot } from '../../../src/core/energy/SlotSnapshot.type';
import type { TimeWindow } from '../../../src/core/TimeWindow.type';
import type { chooseExecutionSlot } from '../../../src/core/scheduling/chooseExecutionSlot';
import { createEnergyMap } from '../../../src/core/energy/maps/createEnergyMap';

export const startAt = '2026-10-28T18:00:00Z';
export const totalHours = 4;

export function timestamp(hour: number): string {
  return new Date(Date.parse(startAt) + hour * 3_600_000).toISOString();
}

const computeProfile = 'scenario-1kWh-per-GPUh';
const locations = ['utah-grid', 'utah-solar'];

/** Supplied jobs for selection playback; choosing a slot does not execute their work. */
export const jobs: Job[] = [
  {
    id: 'job-01', workloadRef: 'synthetic-stream-batch-01', computeProfile,
    window: { startAt: timestamp(0), endAt: timestamp(1) },
    allowedLocations: [...locations], homeLocation: 'utah-grid', currentLocation: 'utah-grid',
    readyAt: timestamp(0), workGpuH: 1, remainingGpuH: 1, maxGpus: 1, dataGB: 0, state: 'queued',
  },
  {
    id: 'job-02', workloadRef: 'synthetic-stream-batch-02', computeProfile,
    window: { startAt: timestamp(1), endAt: timestamp(5) },
    allowedLocations: [...locations], homeLocation: 'utah-grid', currentLocation: 'utah-grid',
    readyAt: timestamp(1), workGpuH: 1, remainingGpuH: 1, maxGpus: 1, dataGB: 0, state: 'queued',
  },
  {
    id: 'job-03', workloadRef: 'synthetic-stream-batch-03', computeProfile,
    window: { startAt: timestamp(2), endAt: timestamp(3) },
    allowedLocations: [...locations], homeLocation: 'utah-grid', currentLocation: 'utah-grid',
    readyAt: timestamp(2), workGpuH: 1, remainingGpuH: 1, maxGpus: 1, dataGB: 0, state: 'queued',
  },
];

type ScenarioSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  prices: readonly number[];
};

/** Literal synthetic posted prices; no pricing engine, telemetry or ledger is represented. */
const sites: readonly ScenarioSite[] = [
  {
    id: 'utah-grid', name: 'Utah grid example', latitude: 40.7608, longitude: -111.891,
    prices: [0.30, 0.60, 0.08, 0.60, 0.60],
  },
  {
    id: 'utah-solar', name: 'Utah solar example', latitude: 40.2338, longitude: -111.6585,
    prices: [0.10, 0.40, 0.40, 0.05, 0.05],
  },
];

function publication(site: ScenarioSite, slotHour: number, publishedHour: number): SlotSnapshot {
  return {
    status: 'current', source: 'Supplied synthetic stream scenario', simulated: true,
    version: `${site.id}-${slotHour}-published-${publishedHour}`,
    observedAt: timestamp(publishedHour), projected: slotHour > publishedHour,
    location: {
      name: site.name, latitude: site.latitude, longitude: site.longitude, regionId: 'PACE',
    },
    slot: {
      id: `${site.id}-${18 + slotHour}`, locationId: site.id,
      window: { startAt: timestamp(slotHour), endAt: timestamp(slotHour + 1) },
      availablePowerKW: 10, availableEnergyKWh: 10, capGpus: 4, usedGpus: 0,
      postedUsdPerGpuHour: site.prices[slotHour],
      priceBasis: 'Synthetic scenario USD/GPU-hour; supplied prices, no pricing engine',
    },
  };
}

// Each future estimate is published at the current scenario hour, then replaced by
// a nonprojected reading when that slot starts. The real lookup filters publication
// timestamps by asOf; future observations are never relabeled as already known.
const publications: readonly SlotSnapshot[] = sites.flatMap(site =>
  site.prices.flatMap((_price, slotHour) =>
    Array.from({ length: slotHour + 1 }, (_unused, publishedHour) => publication(site, slotHour, publishedHour))));

const suppliedSiteEnergy: SiteEnergy = {
  slots(locationId: string, window: TimeWindow): SlotSnapshot[] {
    return publications.filter(snapshot => snapshot.slot?.locationId === locationId &&
      Date.parse(snapshot.slot.window.startAt) < Date.parse(window.endAt) &&
      Date.parse(snapshot.slot.window.endAt) > Date.parse(window.startAt))
      .map(snapshot => structuredClone(snapshot));
  },
};

const suppliedRegionalGrid: RegionalGrid = {
  read(_regionId: string, _window: TimeWindow): GridContext {
    return { observations: [], forecast: {} };
  },
};

// The four playback ticks end at 22:00. Lookup extends through 23:00 so job-02 can
// compare both supplied cheaper future hours 21:00 and 22:00 before deciding to wait.
export const energy: EnergyMap = createEnergyMap({
  window: { startAt, endAt: timestamp(5) },
  sites: sites.map(site => ({ locationId: site.id, regionId: 'PACE', computeProfile })),
}, { siteEnergy: suppliedSiteEnergy, regionalGrid: suppliedRegionalGrid });

type ScenarioRoutingOptions = Parameters<typeof chooseExecutionSlot>[2];

/** Explicit zero-duration, zero-cost transfer assumption for this selection-only scenario. */
export function routingOptions(asOf: string): ScenarioRoutingOptions {
  return {
    asOf, maximumAgeMinutes: 5, kWhPerGpuHour: 1,
    transferTo: (locationId: string) => locations.includes(locationId) ? { hours: 0, costUsd: 0 } : undefined,
  };
}
