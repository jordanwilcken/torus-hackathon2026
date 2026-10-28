import type { ReplayScenario } from '../core/execution/replay/Replay.types';
import type { SiteEnergyInput } from '../core/energy/site/SiteEnergy.types';
import type { FleetSourceBundle } from './FrozenFleet.type';
import type { FeedState } from './FeedState.type';
import type { SiteWeatherSnapshot } from './SiteWeather.type';
import type { CaisoSnapshot } from '../server/caiso';
import { modeledSites } from './modeledSites';

const hour = 3_600_000;
export const fleetAssumptions = {
  gpuKW: .4, gpus: 8, solarPeakKW: 8, solarPerformanceRatio: .8,
  gridImportLimitKW: 1.5, fixedLoadKW: .2, storageKWh: 2, initialStoredKWh: .6,
  gridCarbonGPerKWh: 400, solarCarbonGPerKWh: 40,
};
export type FleetCapture = {
  scenario: ReplayScenario;
  runInputs: FleetSourceBundle;
  weatherRevision: string;
  priceRevision: string;
  capturedAt: string;
  price: CaisoSnapshot['prices'][number];
};
export type FleetCaptureResult = { available: true; capture: FleetCapture } | { available: false; reason: string };

/** A declared model derived from captured source values. No EIA regional demand is treated as site capacity. */
export function captureLiveFleet(weather: FeedState<SiteWeatherSnapshot>, market: FeedState<CaisoSnapshot>, now: number): FleetCaptureResult {
  const missing = (reason: string): FleetCaptureResult => ({ available: false, reason });
  if (weather.status !== 'ready' || !weather.snapshot || !weather.revision)
    return missing('Waiting for site-specific Open-Meteo forecasts. No substitute weather is used.');
  const weatherAge = now - Date.parse(weather.snapshot.retrievedAt);
  if (!Number.isFinite(weatherAge) || weatherAge < -60_000 || weatherAge > 2 * hour)
    return missing('Weather capture is too old to start a new live-input model. Refresh the public inputs.');
  if (market.status !== 'ready' || !market.snapshot || !market.revision)
    return missing('Waiting for the CAISO reference price. No substitute price is used.');
  const price = market.snapshot.prices.filter(point => Date.parse(point.window.startAt) <= now)
    .toSorted((a, b) => a.window.startAt.localeCompare(b.window.startAt)).at(-1);
  if (!price || now - Date.parse(price.window.endAt) > hour)
    return missing('The CAISO reference price is over one hour old. Refresh before starting a new model.');
  if (price.usdPerMWh < 0)
    return missing('The current wholesale price is negative; this nonnegative-cost model cannot use it. The public input remains visible.');
  const start = Math.ceil(Math.max(now, Date.parse(weather.snapshot.retrievedAt)) / hour) * hour;
  const startAt = new Date(start).toISOString();
  const hours = 24;
  const at = (offset: number) => new Date(start + offset * hour).toISOString();
  const basis = 'Declared city fleet model; not physical site telemetry';
  const revision = `${weather.revision}:${market.revision}`;
  const assumptions = fleetAssumptions;
  const sites: ReplayScenario['sites'] = [];
  for (const place of modeledSites) {
    const weatherSite = weather.snapshot.sites.find(site => site.locationId === place.id);
    const forecast: SiteEnergyInput[] = [];
    const observations: SiteEnergyInput[] = [];
    for (let index = 0; index < hours; index++) {
      const window = { startAt: at(index), endAt: at(index + 1) };
      const radiation = weatherSite?.intervals.find(interval => interval.window.startAt === window.startAt && interval.window.endAt === window.endAt)?.shortwaveRadiationWm2;
      if (radiation === undefined || radiation === null || !Number.isFinite(radiation) || radiation < 0)
        return missing(`Missing forecast interval for ${place.name} at ${window.startAt}. No zero-filled weather is used.`);
      const input: SiteEnergyInput = {
        window,
        supply: { solarKW: assumptions.solarPeakKW * assumptions.solarPerformanceRatio * radiation / 1000,
          fixedLoadKW: assumptions.fixedLoadKW, gridImportLimitKW: assumptions.gridImportLimitKW, protectedKWh: .2 },
        evidence: { source: `Open-Meteo radiation forecast × declared 8 kW array × 0.8 performance ratio; ${place.name}`,
          version: `${revision}:${place.id}:${index}:forecast`, observedAt: weather.snapshot.retrievedAt, status: 'current', projected: true },
        accounting: { solarCarbonGPerKWh: assumptions.solarCarbonGPerKWh, gridCarbonGPerKWh: assumptions.gridCarbonGPerKWh,
          solarUsdPerMWh: 0, gridUsdPerMWh: price.usdPerMWh },
      };
      forecast.push(input);
      // This is an evaluated model input, not a claim that a future forecast was physically observed.
      observations.push({ ...structuredClone(input), evidence: { ...input.evidence,
        source: `Modeled realization of captured forecast; no site meter; ${input.evidence.source}`,
        version: `${revision}:${place.id}:${index}:model`, observedAt: at(index), projected: false } });
    }
    sites.push({ name: place.name, lat: place.latitude, lng: place.longitude, regionId: place.regionId, configuration: { locationId: place.id,
      compute: { capGpus: assumptions.gpus, kWPerGpu: assumptions.gpuKW },
      storage: { initial: { storedKWh: assumptions.initialStoredKWh, carbonKg: .24,
        electricityUsd: assumptions.initialStoredKWh * price.usdPerMWh / 1000 },
        limits: { capacityKWh: assumptions.storageKWh, chargeKW: 2, dischargeKW: 1 }, efficiency: { charge: .9, discharge: .9 } },
      accountingBasis: basis }, computeProfile: 'modeled-400W-gpu', forecast, observations });
  }
  const jobs: ReplayScenario['jobs'] = Array.from({ length: (hours - 4) * 2 }, (_, index) => {
    const arrival = Math.floor(index / 2), home = modeledSites[index % modeledSites.length].id;
    return { id: `work-${String(index + 1).padStart(2, '0')}`, workloadRef: 'declared-synthetic-checkpointable-work',
      computeProfile: 'modeled-400W-gpu', window: { startAt: at(arrival), endAt: at(arrival + 4) },
      allowedLocations: modeledSites.map(site => site.id), homeLocation: home, currentLocation: home,
      readyAt: at(arrival), workGpuH: 3, remainingGpuH: 3, maxGpus: 2, dataGB: .1, state: 'queued' };
  });
  return { available: true, capture: { runInputs: { capturedAt: new Date(now).toISOString(), weather: { revision: weather.revision, snapshot: structuredClone(weather.snapshot), status: 'ready' }, caiso: { revision: market.revision, snapshot: structuredClone(market.snapshot), status: 'ready' }, eia: null }, weatherRevision: weather.revision, priceRevision: market.revision,
    capturedAt: new Date(now).toISOString(), price,
    scenario: { schemaVersion: 1, id: `public-fleet-${start}`, inputRevision: revision,
      label: 'Public weather and reference market inputs; modeled sites, jobs, execution and energy',
      seed: 17, startAt, hours, jobs, sites, carbonPriceUsdPerTonne: 0,
      maximumAgeMinutes: 48 * 60, storageToleranceKWh: .0001,
      routing: { policy: 'fleet', transfer: { bandwidthGBPerHour: 1, kWhPerGB: .01, jobChargeUsdPerGB: .001,
        carbonGPerKWh: assumptions.gridCarbonGPerKWh, electricityUsdPerMWh: price.usdPerMWh, accountingBasis: basis } },
    },
  } };
}
