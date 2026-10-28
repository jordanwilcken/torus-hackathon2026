import { expect, test } from 'vitest';
import { getEnergyMap } from '../../../src/core/energy/getEnergyMap';
import { fakeEnergyMap } from '../../fixtures/legacy/energy/fakeEnergyMap';
import type { EnergyMap } from '../../../src/core/energy/EnergyMap.interface';

const window = { startAt: '2026-10-27T18:00:00Z', endAt: '2026-10-27T19:00:00Z' };
const query = { window, asOf: window.startAt };
const reference = { locationId: 'fake-utah-grid', slotId: 'fake-utah-grid-18' };

test('preserves the source snapshot and raw forecast in each site reading', () => {
  const snapshot = fakeEnergyMap.readSlot(reference, query.asOf, 5);
  const forecast = fakeEnergyMap.readForecast(reference, query.asOf);
  const source: EnergyMap = {
    findSlots: () => [reference],
    readSlot: () => snapshot,
    readForecast: () => forecast,
  };

  const site = getEnergyMap(query, source).sites.get(reference.locationId)!;
  expect(site).toEqual({
    id: reference.locationId, ...snapshot.location,
    slots: [{ reference, snapshot, forecast, availableNow: true }],
  });
});

test('unavailable readings retain their identity without inventing location or slot data', () => {
  const snapshot = { status: 'unavailable' as const, source: 'Fake unavailable input', projected: false, simulated: true };
  const source: EnergyMap = {
    findSlots: () => [reference],
    readSlot: () => snapshot,
    readForecast: () => ({}),
  };

  const site = getEnergyMap(query, source).sites.get(reference.locationId)!;
  expect(site).toEqual({
    id: reference.locationId,
    slots: [{ reference, snapshot, forecast: {}, availableNow: false }],
  });
});

test('current availability excludes stale, projected, future, exhausted and unavailable slots', () => {
  const snapshot = fakeEnergyMap.readSlot(reference, query.asOf, 5);
  const cases = [
    { ...snapshot, status: 'stale' as const },
    { ...snapshot, projected: true },
    { ...snapshot, slot: { ...snapshot.slot!, usedGpus: snapshot.slot!.capGpus } },
    { ...snapshot, slot: { ...snapshot.slot!, availableEnergyKWh: 0 } },
    { ...snapshot, slot: { ...snapshot.slot!, availablePowerKW: 0 } },
    { ...snapshot, slot: { ...snapshot.slot!, window: { startAt: window.endAt, endAt: '2026-10-27T20:00:00Z' } } },
    { ...snapshot, status: 'unavailable' as const, slot: undefined },
  ];
  for (const reading of cases) {
    const source: EnergyMap = { findSlots: () => [reference], readSlot: () => reading, readForecast: () => ({}) };
    expect(getEnergyMap(query, source).sites.get(reference.locationId)!.slots[0].availableNow).toBe(false);
  }
  const ended: EnergyMap = { findSlots: () => [reference], readSlot: () => snapshot, readForecast: () => ({}) };
  expect(getEnergyMap({ ...query, asOf: window.endAt }, ended).sites.get(reference.locationId)!.slots[0].availableNow).toBe(false);
});

test('preserves separate same-site slot windows and their supplied energy', () => {
  const second = { ...reference, slotId: 'fake-utah-grid-1830' };
  const halfPast = '2026-10-27T18:30:00Z';
  const source: EnergyMap = {
    findSlots: () => [reference, second],
    readSlot(slotReference, asOf, maximumAgeMinutes) {
      const snapshot = fakeEnergyMap.readSlot(reference, asOf, maximumAgeMinutes);
      const earlier = slotReference.slotId === reference.slotId;
      snapshot.slot = {
        ...snapshot.slot!, id: slotReference.slotId,
        window: earlier ? { startAt: window.startAt, endAt: halfPast } : { startAt: halfPast, endAt: window.endAt },
        availableEnergyKWh: earlier ? .5 : .25,
      };
      return snapshot;
    },
    readForecast: () => ({}),
  };

  const slots = getEnergyMap(query, source).sites.get(reference.locationId)!.slots;
  expect(slots.map(reading => ({
    reference: reading.reference,
    window: reading.snapshot.slot?.window,
    availableEnergyKWh: reading.snapshot.slot?.availableEnergyKWh,
  }))).toEqual([
    { reference, window: { startAt: window.startAt, endAt: halfPast }, availableEnergyKWh: .5 },
    { reference: second, window: { startAt: halfPast, endAt: window.endAt }, availableEnergyKWh: .25 },
  ]);
});
