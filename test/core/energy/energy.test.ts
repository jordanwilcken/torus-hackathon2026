import { expect, test } from 'vitest';
import { createFakeEnergyMap } from '../../fixtures/legacy/energy/fakeEnergyMap.js';
import { getEnergyMap } from '../../../src/core/energy/getEnergyMap.js';
import supplied from '../../fixtures/legacy/energy/stale-sites.json';

test('the live map does not recommend a location from stale evidence', () => {
  const readings = structuredClone(supplied);
  readings.sites[0].snapshot.observedAt = '2026-10-27T12:00:00Z';
  readings.sites[1].snapshot.observedAt = '2026-10-27T12:05:00Z';
  const source = createFakeEnergyMap(readings as Parameters<typeof createFakeEnergyMap>[0], {});

  const map = getEnergyMap({
    asOf: '2026-10-27T12:06:00Z',
    window: { startAt: '2026-10-27T12:00:00Z', endAt: '2026-10-27T13:00:00Z' },
    locations: ['A', 'B'],
  }, source, 5);

  const stale = map.sites.get('A')!.slots[0];
  const current = map.sites.get('B')!.slots[0];
  expect(stale.snapshot.status).toBe('stale');
  expect(stale.availableNow).toBe(false);
  expect(current.snapshot.status).toBe('current');
  expect(current.availableNow).toBe(true);
});
