import { expect, test } from 'vitest';
import type { EnergyMap } from '../../../../src/core/energy/EnergyMap.interface.js';
import type { SlotSnapshot } from '../../../../src/core/energy/SlotSnapshot.type.js';
import type { Forecast } from '../../../../src/core/energy/Forecast.type.js';
import type { SlotForecast } from '../../../../src/core/energy/SlotForecast.type.js';
import { fenceEnergyMap } from '../../../../src/core/execution/simulation/energyFence.js';

const tickStart = '2026-10-27T18:00:00Z';
const oneSecondLater = '2026-10-27T18:00:01Z';
const nextHour = '2026-10-27T19:00:00Z';

const snapshot = (slotId: string, observedAt: string | undefined): SlotSnapshot => ({
  status: 'current', source: 'recorded-site', version: `${slotId}-v1`, observedAt, projected: false, simulated: true,
  slot: {
    id: slotId, locationId: slotId, window: { startAt: tickStart, endAt: nextHour },
    availablePowerKW: 10, availableEnergyKWh: 10, capGpus: 4, usedGpus: 0, postedUsdPerGpuHour: 0.04, priceBasis: 'test',
  },
});

const forecast = (issuedAt: string | undefined, retrievedAt: string): Forecast => ({
  source: 'recorded-forecast', scope: 'PACE', basis: 'test', unit: 'gCO2e/kWh', issuedAt, retrievedAt, simulated: true,
  points: [{ window: { startAt: nextHour, endAt: '2026-10-27T20:00:00Z' }, value: 300 }],
});

/** Deliberately unfenced: returns every recorded item whatever asOf says, and records the asOf it was asked for. */
function recordedMap() {
  const snapshots: Record<string, SlotSnapshot> = {
    'at-tick-start': snapshot('at-tick-start', tickStart),
    'one-second-late': snapshot('one-second-late', oneSecondLater),
    'no-observation-time': snapshot('no-observation-time', undefined),
  };
  const forecasts: SlotForecast = {
    carbon: forecast(tickStart, tickStart),
    demand: forecast(nextHour, tickStart),
    solar: forecast(undefined, '2026-10-27T17:00:00Z'),
  };
  const asked: Array<string> = [];
  const map: EnergyMap = {
    findSlots(query) {
      asked.push(`find@${query.asOf}`);
      return Object.keys(snapshots).map(slotId => ({ locationId: slotId, slotId }));
    },
    readSlot(reference, asOf) {
      asked.push(`slot@${asOf}`);
      return structuredClone(snapshots[reference.slotId]);
    },
    readForecast(_reference, asOf) {
      asked.push(`forecast@${asOf}`);
      return structuredClone(forecasts);
    },
  };
  return { map, asked, snapshots, forecasts };
}

const ref = (slotId: string) => ({ locationId: slotId, slotId });

test('site evidence observed exactly at tick start stays visible; one second later it is unavailable', () => {
  const { map, snapshots } = recordedMap();
  const fenced = fenceEnergyMap(map, tickStart);

  expect(fenced.readSlot(ref('at-tick-start'), tickStart, 5)).toEqual(snapshots['at-tick-start']);
  expect(fenced.readSlot(ref('one-second-late'), tickStart, 5)).toEqual({
    status: 'unavailable', source: 'recorded-site', projected: false, simulated: true,
  });
});

test('a snapshot without an observation time cannot be shown as current evidence', () => {
  const { map } = recordedMap();

  expect(fenceEnergyMap(map, tickStart).readSlot(ref('no-observation-time'), tickStart, 5)).toEqual({
    status: 'unavailable', source: 'recorded-site', projected: false, simulated: true,
  });
});

test('forecasts issued after tick start are withheld; issuedAt falls back to retrievedAt', () => {
  const { map, forecasts } = recordedMap();

  expect(fenceEnergyMap(map, tickStart).readForecast(ref('at-tick-start'), tickStart)).toEqual({
    carbon: forecasts.carbon, solar: forecasts.solar,
  });
});

test('a planning read that asks about a later instant is clamped to tick start', () => {
  const { map, asked } = recordedMap();
  const fenced = fenceEnergyMap(map, tickStart);

  fenced.findSlots({ window: { startAt: tickStart, endAt: nextHour }, asOf: nextHour });
  const late = fenced.readSlot(ref('one-second-late'), nextHour, 120);
  fenced.readForecast(ref('at-tick-start'), nextHour);
  const earlier = fenced.readSlot(ref('at-tick-start'), '2026-10-27T17:30:00Z', 120);

  expect(late.status).toBe('unavailable');
  expect(earlier.status).toBe('unavailable');
  expect(asked).toEqual(expect.arrayContaining([`find@${tickStart}`, `forecast@${tickStart}`, 'slot@2026-10-27T17:30:00Z']));
  expect(asked.every(call => call.endsWith(tickStart) || call.endsWith('17:30:00Z'))).toBe(true);
});

test('slot discovery keeps only slots with evidence observed by tick start, as copies', () => {
  const { map } = recordedMap();
  const shared = ref('at-tick-start');
  const sharing: EnergyMap = { ...map, findSlots: () => [shared] };

  expect(fenceEnergyMap(map, tickStart).findSlots({ window: { startAt: tickStart, endAt: nextHour }, asOf: tickStart }))
    .toEqual([ref('at-tick-start')]);
  fenceEnergyMap(sharing, tickStart).findSlots({ window: { startAt: tickStart, endAt: nextHour }, asOf: tickStart })[0].slotId = 'mutated';
  expect(shared.slotId).toBe('at-tick-start');
});

test('discovery fails closed when the wrapped map hides a later slot as undated and unavailable', () => {
  const hidden: EnergyMap = {
    findSlots: () => [ref('later')],
    readSlot: () => ({ status: 'unavailable', source: 'fake-local-energy', projected: false, simulated: true }),
    readForecast: () => ({}),
  };

  expect(fenceEnergyMap(hidden, tickStart).findSlots({ window: { startAt: tickStart, endAt: nextHour }, asOf: tickStart })).toEqual([]);
});

test('an unavailable snapshot from after tick start carries none of its later fields', () => {
  const later: SlotSnapshot = { ...snapshot('later', oneSecondLater), status: 'unavailable', siteEnergy: { solarKWh: 123 } };
  const map: EnergyMap = { findSlots: () => [], readSlot: () => later, readForecast: () => ({}) };

  expect(fenceEnergyMap(map, tickStart).readSlot(ref('later'), tickStart, 5)).toEqual({
    status: 'unavailable', source: 'recorded-site', projected: false, simulated: true,
  });
});

test('evidence returned to planning is a copy that cannot change the underlying map', () => {
  const shared = snapshot('shared', tickStart);
  const series: SlotForecast = { carbon: forecast(tickStart, tickStart) };
  const map: EnergyMap = { findSlots: () => [], readSlot: () => shared, readForecast: () => series };
  const fenced = fenceEnergyMap(map, tickStart);

  fenced.readSlot(ref('shared'), tickStart, 5).slot!.postedUsdPerGpuHour = 777;
  fenced.readForecast(ref('shared'), tickStart).carbon!.points[0].value = 0;

  expect(shared.slot!.postedUsdPerGpuHour).toBe(0.04);
  expect(series.carbon!.points[0].value).toBe(300);
});

const query = { window: { startAt: tickStart, endAt: nextHour }, asOf: tickStart };

test('discovery returns the same detached reference it checked, even if a getter or readSlot changes the source', () => {
  const { map } = recordedMap();
  let reads = 0;
  const shifting = { locationId: 'at-tick-start', get slotId() { reads += 1; return reads === 1 ? 'at-tick-start' : 'one-second-late'; } };
  const mutated = ref('at-tick-start');
  const viaGetter: EnergyMap = { ...map, findSlots: () => [shifting] };
  const viaReadSlot: EnergyMap = {
    ...map, findSlots: () => [mutated],
    readSlot: (reference, asOf, age) => {
      const result = map.readSlot(reference, asOf, age);
      reference.slotId = 'one-second-late';
      mutated.slotId = 'one-second-late';
      return result;
    },
  };

  expect(fenceEnergyMap(viaGetter, tickStart).findSlots(query)).toEqual([ref('at-tick-start')]);
  expect(fenceEnergyMap(viaReadSlot, tickStart).findSlots(query)).toEqual([ref('at-tick-start')]);
});

test('discovery drops a reference whose snapshot describes a different slot', () => {
  const { map, snapshots } = recordedMap();
  const mismatched: EnergyMap = { ...map, findSlots: () => [ref('one-second-late')], readSlot: () => structuredClone(snapshots['at-tick-start']) };

  expect(fenceEnergyMap(mismatched, tickStart).findSlots(query)).toEqual([]);
});

test('malformed candidates are dropped one by one while dated current and stale slots stay', () => {
  const { map, snapshots } = recordedMap();
  const stale = { ...snapshot('stale-earlier', '2026-10-27T16:00:00Z'), status: 'stale' as const };
  const readings: Record<string, unknown> = {
    'bad-time': snapshot('bad-time', 'not a timestamp'),
    'null-snapshot': null,
    'uncloneable': { ...snapshot('uncloneable', tickStart), extra: () => 1 },
    'stale-earlier': stale,
    'at-tick-start': snapshots['at-tick-start'],
  };
  const messy: EnergyMap = {
    ...map,
    findSlots: () => [null, 42, { locationId: 1, slotId: 'x' }, ref('bad-time'), ref('null-snapshot'), ref('uncloneable'),
      ref('throws'), ref('stale-earlier'), ref('at-tick-start')] as unknown as ReturnType<EnergyMap['findSlots']>,
    readSlot: reference => {
      if (reference.slotId === 'throws') throw new Error('broken reading');
      return readings[reference.slotId] as SlotSnapshot;
    },
  };

  expect(fenceEnergyMap(messy, tickStart).findSlots(query)).toEqual([ref('stale-earlier'), ref('at-tick-start')]);
});
