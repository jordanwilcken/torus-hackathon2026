import type { Job } from '../../jobs/Job.type.js';
import type { DeadlineCoverage, PlannedCapacitySlot, PlanningReadiness } from './CapacityPlan.types.js';
import { powerLimitedGpus, energyLimitedGpus } from '../../scheduling/math/chooseExecutionSlot.generated.js';

const hour = 3_600_000;
const tolerance = 1e-9;

/** Greedy, deadline-first shared-capacity witness. Failure is not a proof that no schedule exists.
 * Each job uses one eligible destination, and occupies its integer GPU quota for the full slot.
 * This deliberately avoids inventing intra-hour sharing or unaccounted subsequent transfers.
 */
export function deadlineCoverage(jobs: readonly Job[], slots: readonly PlannedCapacitySlot[],
  capacities: readonly number[], readiness: readonly PlanningReadiness[], asOf: string, carbonBlind: boolean) {
  const available = [...capacities];
  const availableEnergy = slots.map(slot => slot.availableEnergyKWh ?? 0);
  const at = Date.parse(asOf);
  const candidates = (job: Job) => [...new Set(slots.filter(slot =>
    slot.computeProfile === job.computeProfile && job.allowedLocations.includes(slot.locationId) &&
    readyAt(job, slot.locationId, readiness, at) !== undefined).map(slot => slot.locationId))];
  const ordered = jobs.filter(job => job.remainingGpuH > tolerance && job.state !== 'done' && job.state !== 'missed')
    .toSorted((left, right) => Date.parse(left.window.endAt) - Date.parse(right.window.endAt) ||
      left.id.localeCompare(right.id));
  const deadlines: DeadlineCoverage[] = [];
  const opened = slots.map(() => 0);

  for (const job of ordered) {
    const alternatives = candidates(job).map(locationId => {
      const ready = readyAt(job, locationId, readiness, at)!;
      const end = Date.parse(job.window.endAt);
      const eligible = slots.map((slot, index) => ({ slot, index,
        hours: (Math.min(Date.parse(slot.window.endAt), end) -
          Math.max(Date.parse(slot.window.startAt), ready, Date.parse(job.window.startAt), at)) / hour,
      })).filter(item => item.slot.locationId === locationId && item.hours > 0 && available[item.index] > 0)
        .sort((left, right) => (carbonBlind ? 0 : (left.slot.carbonGPerKWh ?? Infinity) -
          (right.slot.carbonGPerKWh ?? Infinity)) ||
          Date.parse(left.slot.window.startAt) - Date.parse(right.slot.window.startAt));
      let remaining = job.remainingGpuH;
      let burden = 0;
      const allocations: Array<{ index: number; slotId: string; gpus: number; workGpuH: number }> = [];
      for (const { slot, index, hours } of eligible) {
        if (remaining <= tolerance) break;
        // Use the chooser's same peak-power and partial-work energy rules, then reserve
        // both scarce quantities across jobs. No intra-hour GPU sharing is invented.
        const capacity = { maxGpus: job.maxGpus, capGpus: available[index], usedGpus: 0,
          availablePowerKW: available[index] * slot.kWhPerGpuHour,
          availableEnergyKWh: availableEnergy[index], kWhPerGpuHour: slot.kWhPerGpuHour,
          remainingGpuH: remaining, durationHours: hours };
        const gpus = energyLimitedGpus({ ...capacity, initialGpus: powerLimitedGpus(capacity) });
        if (gpus <= 0) continue;
        const workGpuH = Math.min(remaining, gpus * hours);
        allocations.push({ index, slotId: slot.slotId, gpus, workGpuH });
        remaining -= workGpuH;
        if (!carbonBlind) burden += workGpuH * (slot.carbonGPerKWh ?? 0) * slot.kWhPerGpuHour;
      }
      return { locationId, remaining, burden, allocations };
    }).sort((left, right) =>
      Number(left.remaining > tolerance) - Number(right.remaining > tolerance) ||
      (left.remaining > tolerance ? left.remaining - right.remaining : 0) ||
      left.burden - right.burden ||
      Number(left.locationId !== job.currentLocation) - Number(right.locationId !== job.currentLocation) ||
      left.locationId.localeCompare(right.locationId));
    const chosen = alternatives[0];
    const remaining = chosen?.remaining ?? job.remainingGpuH;
    for (const allocation of chosen?.allocations ?? []) {
      available[allocation.index] -= allocation.gpus;
      availableEnergy[allocation.index] = Math.max(0, availableEnergy[allocation.index] -
        allocation.workGpuH * slots[allocation.index].kWhPerGpuHour);
      opened[allocation.index] += allocation.gpus;
    }
    deadlines.push({
      jobId: job.id, requiredGpuH: job.remainingGpuH, plannedGpuH: job.remainingGpuH - Math.max(0, remaining),
      deadline: job.window.endAt, status: remaining <= tolerance ? 'covered' : 'shortfall', conditional: true,
      ...(chosen ? { locationId: chosen.locationId } : {}),
      allocations: (chosen?.allocations ?? []).map(({ index: _, ...allocation }) => allocation),
      reason: remaining <= tolerance
        ? 'Remaining work fits shared eligible capacity under this conditional plan; routing and future inputs must be rechecked.'
        : 'This conservative shared-capacity plan does not cover all remaining work before the deadline; no completion promise.',
    });
  }
  return { deadlines, opened };
}

function readyAt(job: Job, locationId: string, readiness: readonly PlanningReadiness[], at: number): number | undefined {
  if (job.state === 'moving') {
    if (locationId !== job.transferToLocation) return undefined;
    return Math.max(at, Date.parse(job.readyAt), Date.parse(job.window.startAt));
  }
  if (locationId === job.currentLocation) return Math.max(at, Date.parse(job.readyAt), Date.parse(job.window.startAt));
  const supplied = readiness.find(value => value.jobId === job.id && value.locationId === locationId);
  return supplied ? Math.max(at, Date.parse(supplied.readyAt), Date.parse(job.readyAt), Date.parse(job.window.startAt)) : undefined;
}
