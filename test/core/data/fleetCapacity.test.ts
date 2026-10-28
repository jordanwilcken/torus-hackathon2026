import { expect, test } from 'vitest';
import { fleetCapacity } from '../../../src/ui/fleet/fleetCapacity';

const window = { startAt: '2026-10-28T21:00:00.000Z', endAt: '2026-10-28T22:00:00.000Z' };
const snapshot = { status: 'current' as const, slot: { id: 'A@21', locationId: 'A', window,
  capGpus: 2, usedGpus: 0, availablePowerKW: .8, availableEnergyKWh: .8, postedUsdPerGpuHour: .01, priceBasis: 'modeled' } };
const plan = { status: 'current' as const, physicalFreeGpus: 8, availableEnergyKWh: 3.2, capGpus: 2, usedGpus: 0 };
const accepted = { allocatedGpus: 2, energy: [{ window, estimatedKWh: .8 }] };

test('two accepted GPUs leave six physical GPUs open even when the two-GPU plan is full', () => {
  const capacity = fleetCapacity({ snapshot, plan, planPublished: true, kWPerGpu: .4, allocations: [accepted] });
  expect(capacity).toMatchObject({
    availableGpus: 6, scheduledGpus: 2, plannedGpus: 2, capacityState: 'available',
  });
  expect(capacity.remainingEnergyKWh).toBeCloseTo(2.4, 12);
});

test('closing a scheduler quota does not turn eight physically supported GPUs into zero', () => {
  const closed = { ...snapshot, slot: { ...snapshot.slot, capGpus: 0, availablePowerKW: 0, availableEnergyKWh: 0 } };
  expect(fleetCapacity({ snapshot: closed, plan: { ...plan, capGpus: 0 }, planPublished: true, kWPerGpu: .4, allocations: [] })).toEqual({
    availableGpus: 8, remainingEnergyKWh: 3.2, scheduledGpus: 0, plannedGpus: 0, capacityState: 'available',
  });
});

test('a partial-hour physical offer keeps its peak GPU count and its finite energy budget separate', () => {
  expect(fleetCapacity({ snapshot, plan: { ...plan, physicalFreeGpus: 2, availableEnergyKWh: .1 }, planPublished: true, kWPerGpu: .4, allocations: [] })).toMatchObject({
    availableGpus: 2, remainingEnergyKWh: .1, capacityState: 'available',
  });
});

test('accepted work that consumes the energy budget leaves no extra GPU capacity and is marked allocated', () => {
  expect(fleetCapacity({ snapshot, plan: { ...plan, availableEnergyKWh: .8 }, planPublished: true, kWPerGpu: .4, allocations: [accepted] })).toMatchObject({
    availableGpus: 0, remainingEnergyKWh: 0, capacityState: 'allocated',
  });
});

test('a physically empty offer is constrained rather than allocated', () => {
  expect(fleetCapacity({ snapshot, plan: { ...plan, physicalFreeGpus: 0, availableEnergyKWh: 0 }, planPublished: true, kWPerGpu: .4, allocations: [] })).toMatchObject({
    availableGpus: 0, remainingEnergyKWh: 0, capacityState: 'constrained',
  });
});

test('accepted work that fills the GPU limit is allocated even if energy remains', () => {
  expect(fleetCapacity({ snapshot, plan: { ...plan, physicalFreeGpus: 2 }, planPublished: true, kWPerGpu: .4, allocations: [accepted] })).toMatchObject({
    availableGpus: 0, capacityState: 'allocated',
  });
});

test('missing physical energy remains unknown even if a planned quota or allocation is present', () => {
  expect(fleetCapacity({ snapshot, plan: { ...plan, availableEnergyKWh: undefined }, planPublished: true, kWPerGpu: .4, allocations: [accepted] })).toMatchObject({
    availableGpus: null, remainingEnergyKWh: null, capacityState: 'unknown',
  });
  expect(fleetCapacity({ snapshot, planPublished: true, kWPerGpu: .4, allocations: [] })).toMatchObject({
    availableGpus: null, remainingEnergyKWh: null, capacityState: 'unknown',
  });
});

test('before any plan the physical publication uses the same GPU and energy meaning', () => {
  expect(fleetCapacity({ snapshot: { ...snapshot, slot: { ...snapshot.slot, capGpus: 8, availablePowerKW: 3.2, availableEnergyKWh: 3.2 } },
    planPublished: false, kWPerGpu: .4, allocations: [] })).toEqual({
    availableGpus: 8, remainingEnergyKWh: 3.2, scheduledGpus: 0, plannedGpus: null, capacityState: 'available',
  });
});
