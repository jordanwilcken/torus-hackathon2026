import type { PriceHour } from '../../../src/ui/scheduling/PostedPrices.type';
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type';

export type Scene = 'selected' | 'waiting' | 'stale' | 'unknown' | 'revised' | 'empty' | 'no-estimate' | 'zero' | 'tiny' | 'overnight' | 'no-forecast' | 'job-b' | 'normalized-forecast';
export const at = '2026-10-28T12:00:00Z';
export const siteNames = { lehi: 'Lehi', provo: 'Provo' };
function hour(site: string, start: number, rate: number, projected = false): PriceHour {
  const window = { startAt: `2026-10-28T${start}:00:00Z`, endAt: `2026-10-28T${start + 1}:00:00Z` };
  const reference = { locationId: site, slotId: `${site}-${start}` };
  return {
    reference, window,
    snapshot: {
      status: 'current', source: 'illustrative-site-ledger', version: `${site}-v1`, observedAt: at,
      projected, simulated: true,
      slot: { id: reference.slotId, locationId: site, window, capGpus: 4, usedGpus: 0,
        availablePowerKW: 4, availableEnergyKWh: 4, postedUsdPerGpuHour: rate,
        priceBasis: 'Modeled electricity + operational CO2 at $100/tonne; full available mix' },
    },
    forecast: { carbon: {
      source: 'illustrative-carbon-model', scope: 'PACE', basis: 'Operational CO2', unit: 'gCO2/kWh',
      issuedAt: '2026-10-28T11:00:00Z', retrievedAt: '2026-10-28T11:05:00Z', simulated: true,
      points: [{ window, value: projected ? 200 : 300 }],
    } },
  };
}
const lehi = [hour('lehi', 12, .075), hour('lehi', 13, .045, true), hour('lehi', 14, .095, true), hour('lehi', 15, .08, true)];
lehi[0].breakdown = { electricityUsdPerGpuHour: .045, carbonUsdPerGpuHour: .03 };
lehi[2].snapshot.slot!.usedGpus = 4;
lehi[2].snapshot.slot!.availableEnergyKWh = 0;
lehi[2].snapshot.slot!.availablePowerKW = 0;
lehi[3].snapshot = { status: 'unavailable', source: 'illustrative-site-ledger', projected: true, simulated: true };
const provo = [hour('provo', 12, .09), hour('provo', 13, .065, true), hour('provo', 14, .085, true), hour('provo', 15, .11, true)];
const selected: JobOutcome = {
  selected: true,
  allocation: { jobId: 'training-batch', slot: lehi[0].reference, slotVersion: 'lehi-v1', allocatedGpus: 1,
    kWhPerGpuHour: 1, requiredPowerKW: 1,
    energy: [{ window: { startAt: at, endAt: '2026-10-28T12:15:00Z' }, estimatedKWh: .25 }],
    forecast: lehi[0].forecast!, postedUsdPerGpuHour: .075, priceBasis: lehi[0].snapshot.slot!.priceBasis },
  explanation: 'Lehi has the lower eligible current price and enough capacity before the deadline.',
};
const waiting: JobOutcome = { selected: false, explanation: 'Waiting for the eligible 13:00 window; no current allocation selected.' };
export const history = [
  { at: '2026-10-28T11:00:00Z', reason: 'Waited for Lehi capacity to become available.' },
  { at, reason: selected.explanation },
];
export function scenario(scene: Scene) {
  const sites = structuredClone([{ id: 'lehi', name: 'Lehi', hours: lehi }, { id: 'provo', name: 'Provo', hours: provo }]);
  let outcome: JobOutcome | undefined = structuredClone(selected);
  if (scene === 'waiting') outcome = waiting;
  if (scene === 'stale' || scene === 'unknown') {
    for (const site of sites) for (const hour of site.hours) {
      if (scene === 'stale') hour.snapshot.status = 'stale';
      else {
        hour.snapshot = { status: 'unavailable', source: 'not-supplied', projected: hour.snapshot.projected, simulated: true };
        hour.breakdown = undefined;
      }
    }
    outcome = { selected: false, explanation: scene === 'stale' ? 'Current site evidence is stale. Waiting for a refreshed offer.' : 'No usable site readings were supplied.' };
  }
  if (scene === 'revised') sites[0].hours[0].snapshot.version = 'lehi-v2';
  if (scene === 'no-forecast') sites.forEach(site => site.hours.forEach(hour => { hour.forecast = undefined; }));
  if (scene === 'job-b' && outcome.selected) outcome.allocation.jobId = 'training-batch-b';
  if (scene === 'normalized-forecast') sites.forEach(site => site.hours.forEach(hour => {
    hour.forecast?.carbon?.points.forEach(point => {
      point.window = { startAt: new Date(point.window.startAt).toISOString(), endAt: new Date(point.window.endAt).toISOString() };
    });
  }));
  if (scene === 'no-estimate' && outcome.selected) outcome.allocation.energy = [];
  if ((scene === 'zero' || scene === 'tiny') && outcome.selected) {
    const rate = scene === 'zero' ? 0 : .0000001;
    sites[0].hours[0].snapshot.slot!.postedUsdPerGpuHour = rate;
    sites[0].hours[0].breakdown = { electricityUsdPerGpuHour: rate, carbonUsdPerGpuHour: 0 };
    outcome.allocation.postedUsdPerGpuHour = rate;
  }
  if (scene === 'overnight') {
    const tomorrow = sites[0].hours[1];
    tomorrow.reference.slotId = 'lehi-next-12';
    tomorrow.window = { startAt: '2026-10-29T12:00:00Z', endAt: '2026-10-29T13:00:00Z' };
    tomorrow.snapshot.slot!.id = tomorrow.reference.slotId;
    tomorrow.snapshot.slot!.window = tomorrow.window;
    tomorrow.forecast!.carbon!.points[0].window = tomorrow.window;
    sites[0].hours = [sites[0].hours[0], tomorrow];
  }
  if (scene === 'empty') { sites.forEach(site => { site.hours = []; }); outcome = undefined; }
  return { sites, outcome };
}
