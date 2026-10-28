import type { Job } from '../../../src/core/jobs/Job.type';
import type { EnergyMap } from '../../../src/core/energy/EnergyMap.interface';
import type { SiteEnergy } from '../../../src/core/energy/SiteEnergy.interface';
import type { RegionalGrid } from '../../../src/core/energy/RegionalGrid.interface';
import type { GridContext } from '../../../src/core/energy/GridContext.type';
import type { SlotSnapshot } from '../../../src/core/energy/SlotSnapshot.type';
import type { TimeWindow } from '../../../src/core/TimeWindow.type';
import type { chooseExecutionSlot } from '../../../src/core/scheduling/chooseExecutionSlot';
import type { InputEvent } from '../../../src/core/execution/simulation/clock';
import type { ScenarioEventOption } from '../../../src/ui/core/controls/PlaybackControls.types';
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

const suppliedRegionalGrid: RegionalGrid = {
  read(_regionId: string, _window: TimeWindow): GridContext {
    return { observations: [], forecast: {} };
  },
};

type SampleEvent =
  | { atHour: number; kind: 'forecast-error'; payload: { locationId: string; projectedUsdPerGpuHour: number } }
  | { atHour: number; kind: 'site-outage'; payload: { locationId: string; availablePowerKW: number; availableEnergyKWh: number; capGpus: number } }
  | { atHour: number; kind: 'utility-import-limit'; payload: { locationId: string; availablePowerKW: number; availableEnergyKWh: number; gridImportLimitKW: number } }
  | { atHour: number; kind: 'reserve-change'; payload: { locationId: string; storedKWh: number; protectedKWh: number; availablePowerKW: number; availableEnergyKWh: number } };

/** Sample replacements for this fixture, not forecasts, physical dispatch or computed prices. */
export function scenarioEvents(atHour: number): ScenarioEventOption[] {
  return [
    {
      id: 'forecast-error', label: 'Forecast error',
      description: 'Sample replacement: projected solar quotes become $0.90/GPU-hour; current quotes retain their original price.',
      input: { atHour, kind: 'forecast-error', payload: { locationId: 'utah-solar', projectedUsdPerGpuHour: 0.90 } },
    },
    {
      id: 'site-outage', label: 'Site outage',
      description: 'Sample replacement: solar discretionary power, energy and GPU capacity become zero.',
      input: { atHour, kind: 'site-outage', payload: { locationId: 'utah-solar', availablePowerKW: 0, availableEnergyKWh: 0, capGpus: 0 } },
    },
    {
      id: 'utility-import-limit', label: 'Utility import limit',
      description: 'Sample replacement: grid discretionary power/energy and the supplied import limit become zero.',
      input: { atHour, kind: 'utility-import-limit', payload: { locationId: 'utah-grid', availablePowerKW: 0, availableEnergyKWh: 0, gridImportLimitKW: 0 } },
    },
    {
      id: 'reserve-change', label: 'Protected reserve change',
      description: 'Sample replacement: solar has 4 kWh stored and protected, with zero discretionary power or energy.',
      input: { atHour, kind: 'reserve-change', payload: { locationId: 'utah-solar', storedKWh: 4, protectedKWh: 4, availablePowerKW: 0, availableEnergyKWh: 0 } },
    },
  ];
}

function sampleEvent(event: InputEvent): SampleEvent {
  if (!Number.isInteger(event.atHour) || event.atHour < 0 || event.atHour >= totalHours)
    throw new RangeError('Sample events require an hour within the playback horizon.');
  const option = scenarioEvents(event.atHour).find(option => option.input.kind === event.kind);
  const payload = event.payload;
  if (!option || payload === null || typeof payload !== 'object' ||
      !Object.entries(option.input.payload as Record<string, unknown>)
        .every(([key, value]) => (payload as Record<string, unknown>)[key] === value))
    throw new RangeError('Use the explicit supplied payload for a supported sample event.');
  return structuredClone(event) as SampleEvent;
}

function replaceSuppliedReading(snapshot: SlotSnapshot, event: SampleEvent): boolean {
  const slot = snapshot.slot;
  if (!slot || slot.locationId !== event.payload.locationId ||
      Date.parse(snapshot.observedAt!) < Date.parse(timestamp(event.atHour))) return false;
  switch (event.kind) {
    case 'forecast-error':
      if (!snapshot.projected) return false;
      slot.postedUsdPerGpuHour = event.payload.projectedUsdPerGpuHour;
      return true;
    case 'site-outage':
      slot.availablePowerKW = event.payload.availablePowerKW;
      slot.availableEnergyKWh = event.payload.availableEnergyKWh;
      slot.capGpus = event.payload.capGpus;
      return true;
    case 'utility-import-limit':
      slot.availablePowerKW = event.payload.availablePowerKW;
      slot.availableEnergyKWh = event.payload.availableEnergyKWh;
      snapshot.siteEnergy = { ...snapshot.siteEnergy, gridImportLimitKW: event.payload.gridImportLimitKW };
      return true;
    case 'reserve-change':
      slot.availablePowerKW = event.payload.availablePowerKW;
      slot.availableEnergyKWh = event.payload.availableEnergyKWh;
      snapshot.siteEnergy = { ...snapshot.siteEnergy, storedKWh: event.payload.storedKWh, protectedKWh: event.payload.protectedKWh };
      return true;
  }
}

export type StreamScenario = {
  energy: EnergyMap;
  apply(event: InputEvent): string;
  reset(): void;
};

export function createStreamScenario(): StreamScenario {
  const applied: SampleEvent[] = [];
  const suppliedSiteEnergy: SiteEnergy = {
    slots(locationId: string, window: TimeWindow): SlotSnapshot[] {
      return publications.filter(snapshot => snapshot.slot?.locationId === locationId &&
        Date.parse(snapshot.slot.window.startAt) < Date.parse(window.endAt) &&
        Date.parse(snapshot.slot.window.endAt) > Date.parse(window.startAt))
        .map(publication => {
          const snapshot = structuredClone(publication);
          // Transform one clone in event order. There is still exactly one returned
          // version for each original slot/publication time, never tied alternatives.
          applied.forEach((event, index) => {
            if (replaceSuppliedReading(snapshot, event)) {
              snapshot.version += `:sample-${index}-${event.kind}-${event.atHour}`;
              snapshot.source = 'Supplied synthetic stream scenario with sample event replacements';
            }
          });
          return snapshot;
        });
    },
  };
  // Four playback ticks end at 22:00. Lookup extends through 23:00 so job-02 can
  // compare both supplied cheaper future hours before deciding to wait.
  const energy = createEnergyMap({
    window: { startAt, endAt: timestamp(5) },
    sites: sites.map(site => ({ locationId: site.id, regionId: 'PACE', computeProfile })),
  }, { siteEnergy: suppliedSiteEnergy, regionalGrid: suppliedRegionalGrid });
  return {
    energy,
    apply(event: InputEvent): string {
      const supplied = sampleEvent(event);
      applied.push(supplied);
      switch (supplied.kind) {
        case 'forecast-error': return 'Applied sample forecast replacement: projected solar quotes are $0.90/GPU-hour; current quotes are unchanged.';
        case 'site-outage': return 'Applied sample solar outage: discretionary power, energy and GPU capacity are zero.';
        case 'utility-import-limit': return 'Applied sample grid import limit: import limit and discretionary power/energy are zero.';
        case 'reserve-change': return 'Applied sample solar reserve: 4 kWh stored and protected; discretionary power/energy are zero.';
      }
    },
    reset(): void { applied.length = 0; },
  };
}

/** Immutable baseline compatibility export; interactive playback uses its own session. */
export const energy: EnergyMap = createStreamScenario().energy;

type ScenarioRoutingOptions = Parameters<typeof chooseExecutionSlot>[2];

/** Explicit zero-duration, zero-cost transfer assumption for this selection-only scenario. */
export function routingOptions(asOf: string): ScenarioRoutingOptions {
  return {
    asOf, maximumAgeMinutes: 5, kWhPerGpuHour: 1,
    transferTo: (locationId: string) => locations.includes(locationId) ? { hours: 0, costUsd: 0 } : undefined,
  };
}
