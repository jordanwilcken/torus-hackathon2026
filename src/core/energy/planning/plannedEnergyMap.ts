import type { EnergyMap } from '../EnergyMap.interface.js';
import type { HourlyCapacityPlan } from './CapacityPlan.types.js';

/** Apply a soft plan to current physical publications; reservations still change the live ledger. */
export function plannedEnergyMap(physical: EnergyMap, readPlan: () => HourlyCapacityPlan | undefined): EnergyMap {
  return {
    ...physical,
    readSlot(reference, asOf, maximumAgeMinutes) {
      const snapshot = physical.readSlot(reference, asOf, maximumAgeMinutes);
      const plan = readPlan();
      if (!plan || !snapshot.slot) return snapshot;
      const planned = plan.slots.find(slot => slot.locationId === reference.locationId && slot.slotId === reference.slotId);
      if (!planned || planned.status !== 'current') return { ...snapshot, status: planned?.status ?? 'unavailable', slot: undefined };
      const slot = snapshot.slot;
      const capGpus = Math.max(slot.usedGpus, Math.min(slot.capGpus, planned.capGpus));
      const free = Math.max(0, capGpus - slot.usedGpus);
      return { ...snapshot, slot: { ...slot, capGpus,
        availablePowerKW: Math.min(slot.availablePowerKW, free * planned.kWhPerGpuHour),
        availableEnergyKWh: Math.min(slot.availableEnergyKWh, free * planned.kWhPerGpuHour),
      } };
    },
  };
}
