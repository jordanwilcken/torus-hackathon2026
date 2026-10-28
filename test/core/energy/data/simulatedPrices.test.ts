import { describe, expect, it } from 'vitest';
import { simulatedPriceFor, simulatedPrices } from '../../../../src/core/energy/data/simulatedPrices.js';

describe('explicit simulated prices, separate from grid evidence', () => {
  it.each([
    ['2025-07-31T22:00:00Z', 65], ['2025-07-31T10:00:00Z', 40],
    ['2025-01-15T22:00:00Z', 65], ['2025-01-15T21:30:00Z', 50],
    ['2025-08-01T03:00:00Z', 50], ['2025-08-01T04:00:00Z', 40], ['2025-07-31T12:00:00Z', 50],
  ])('uses America/Denver local time at %s', (startAt, value) => {
    const window = { startAt, endAt: new Date(Date.parse(startAt) + 3600000).toISOString() };
    expect(simulatedPriceFor('PACE', window)).toEqual({ regionId: 'PACE', window, value, unit: 'USD/MWh', simulated: true, source: 'Sunchaser simulated assumption — not an LMP, utility tariff or observed price' });
  });
  it('makes assumptions inspectable and marks unknown regions unavailable', () => {
    expect(simulatedPrices).toMatchObject({ regionId: 'PACE', simulated: true, baseUsdPerMWh: 50, timeZone: 'America/Denver' });
    const result = simulatedPriceFor('UNKNOWN', { startAt: '2025-07-31T22:00:00Z', endAt: '2025-07-31T23:00:00Z' });
    expect(result.value).toBeNull(); expect(result.simulated).toBe(true);
    expect(result.source).toMatch(/^unavailable:/); expect(result.source).toContain('not an LMP');
  });
});
