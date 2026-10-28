import type { SlotSnapshot } from '../../core/energy/SlotSnapshot.type';
import type { PlannedCapacitySlot } from '../../core/energy/planning/CapacityPlan.types';
import type { Allocation } from '../../core/scheduling/Allocation.type';

type CapacityInput = {
  snapshot?: Pick<SlotSnapshot, 'status' | 'slot'>;
  plan?: Pick<PlannedCapacitySlot, 'status' | 'physicalFreeGpus' | 'availableEnergyKWh' | 'capGpus' | 'usedGpus'>;
  planPublished: boolean;
  kWPerGpu: number;
  allocations: readonly Pick<Allocation, 'allocatedGpus' | 'energy'>[];
};

export type FleetCapacity = {
  availableGpus: number | null;
  remainingEnergyKWh: number | null;
  scheduledGpus: number;
  plannedGpus: number | null;
  capacityState: 'unknown' | 'available' | 'allocated' | 'constrained';
};

/** Project this hour's published offer and accepted commitments without changing the model. */
export function fleetCapacity({ snapshot, plan, planPublished, kWPerGpu, allocations }: CapacityInput): FleetCapacity {
  const scheduledGpus = allocations.reduce((total, allocation) => total + allocation.allocatedGpus, 0);
  const scheduledEnergy = allocations.reduce((total, allocation) => total + allocation.energy.reduce((sum, use) => sum + use.estimatedKWh, 0), 0);
  const slot = snapshot?.slot;
  // A published plan retains the physical offer separately from its soft routing quota.
  // Its map snapshot is quota-limited, so it cannot substitute for missing physical evidence.
  const physicalGpus = planPublished ? plan?.physicalFreeGpus : slot
    ? Math.max(0, Math.min(slot.capGpus - slot.usedGpus, Math.floor(slot.availablePowerKW / kWPerGpu))) : undefined;
  const energyKWh = planPublished ? plan?.availableEnergyKWh : slot?.availableEnergyKWh;
  const status = planPublished ? plan?.status : snapshot?.status;
  const plannedGpus = plan ? Math.max(0, plan.capGpus - plan.usedGpus) : null;
  if (status !== 'current' || physicalGpus === undefined || !Number.isInteger(physicalGpus) || physicalGpus < 0
    || energyKWh === undefined || !Number.isFinite(energyKWh) || energyKWh < 0)
    return { availableGpus: null, remainingEnergyKWh: null, scheduledGpus, plannedGpus, capacityState: 'unknown' };
  // Ignore binary64 subtraction residue when all offered energy has been committed.
  const remainingEnergyKWh = Math.max(0, energyKWh - scheduledEnergy);
  const availableGpus = remainingEnergyKWh > 1e-9 ? Math.max(0, physicalGpus - scheduledGpus) : 0;
  return { availableGpus, remainingEnergyKWh, scheduledGpus, plannedGpus,
    capacityState: availableGpus > 0 ? 'available'
      : physicalGpus > 0 && energyKWh > 0 && scheduledGpus > 0 ? 'allocated' : 'constrained' };
}
