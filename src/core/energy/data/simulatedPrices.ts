import type { TimeWindow } from '../../TimeWindow.type.js';
import { windowBounds } from './eia930.js';

export const simulatedPrices = {
  regionId: 'PACE', simulated: true, unit: 'USD/MWh', baseUsdPerMWh: 50, timeZone: 'America/Denver',
  timeOfUse: [
    { fromLocalHour: 22, toLocalHour: 6, multiplier: 0.8 },
    { fromLocalHour: 15, toLocalHour: 21, multiplier: 1.3 },
    { fromLocalHour: 6, toLocalHour: 15, multiplier: 1.0 },
    { fromLocalHour: 21, toLocalHour: 22, multiplier: 1.0 },
  ],
  source: 'Sunchaser simulated assumption — not an LMP, utility tariff or observed price',
} as const;

export function simulatedPriceFor(regionId: string, window: TimeWindow): {
  regionId: string; window: TimeWindow; value: number | null; unit: 'USD/MWh'; simulated: true; source: string;
} {
  const [start] = windowBounds(window);
  if (regionId !== simulatedPrices.regionId) return { regionId, window: { ...window }, value: null, unit: 'USD/MWh', simulated: true, source: `unavailable: unknown region ${regionId}; ${simulatedPrices.source}` };
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: simulatedPrices.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(start));
  const band = simulatedPrices.timeOfUse.find(({ fromLocalHour: from, toLocalHour: to }) => from > to ? hour >= from || hour < to : hour >= from && hour < to);
  return { regionId, window: { ...window }, value: simulatedPrices.baseUsdPerMWh * (band?.multiplier ?? 1), unit: 'USD/MWh', simulated: true, source: simulatedPrices.source };
}
