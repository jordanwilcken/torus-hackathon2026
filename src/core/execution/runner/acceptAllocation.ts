import type { Job } from "../../jobs/Job.type.js";
import type { SelectedJobOutcome } from "../../scheduling/JobOutcome.type.js";
import type { SiteEnergyLoad } from "../../energy/site/SiteEnergy.types.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { ExecutionSite } from "./Executor.types.js";
import { bounds, hour, near, windowAt } from "./executionTime.js";

export type AcceptedAllocation = {
    selection: SelectedJobOutcome;
    site: ExecutionSite;
    load: SiteEnergyLoad;
};

export function allocationKey(selection: SelectedJobOutcome): string {
    const a = selection.allocation;
    return JSON.stringify([a.jobId, a.slot.locationId, a.slot.slotId, a.slotVersion]);
}

/** Forecast descriptions do not change the command's physical or price identity. */
export function allocationSignature(selection: SelectedJobOutcome): string {
    const a = selection.allocation;
    return JSON.stringify([allocationKey(selection), a.allocatedGpus, a.kWhPerGpuHour, a.requiredPowerKW,
        a.postedUsdPerGpuHour, a.priceBasis, a.energy.map(e => [e.window.startAt, e.window.endAt, e.estimatedKWh])]);
}

/** Validate without mutation; the ledger's single reserve call is the acceptance boundary. */
export function prepareAllocation(selection: SelectedJobOutcome, job: Job, site: ExecutionSite,
    current: TimeWindow, maximumAgeMinutes: number): AcceptedAllocation | undefined {
    const a = selection.allocation, canonical = bounds(current);
    if (!canonical || !["queued", "running", "paused"].includes(job.state) || job.remainingGpuH <= 0 ||
        job.currentLocation !== site.locationId || !job.allowedLocations.includes(site.locationId) ||
        job.computeProfile !== site.computeProfile || a.kWhPerGpuHour !== site.kWhPerGpuHour ||
        !Number.isInteger(a.allocatedGpus) || a.allocatedGpus <= 0 || a.allocatedGpus > job.maxGpus ||
        a.energy.length !== 1) return undefined;
    const planned = a.energy[0], interval = bounds(planned.window);
    if (!interval || interval[0] !== Math.max(canonical[0], Date.parse(job.readyAt), Date.parse(job.window.startAt)) ||
        interval[1] > Math.min(canonical[1], Date.parse(job.window.endAt))) return undefined;
    const snapshot = site.ledger.slots(site.locationId, current).find(s => s.slot?.id === a.slot.slotId);
    const slot = snapshot?.slot, observed = Date.parse(snapshot?.observedAt ?? "");
    if (!snapshot || !slot || snapshot.status !== "current" || snapshot.projected || !snapshot.source ||
        snapshot.version !== a.slotVersion || slot.locationId !== site.locationId ||
        !Number.isFinite(observed) || observed > canonical[0] || (canonical[0] - observed) / 60_000 > maximumAgeMinutes ||
        !near(a.postedUsdPerGpuHour, slot.postedUsdPerGpuHour) || a.priceBasis !== slot.priceBasis ||
        !a.priceBasis || a.postedUsdPerGpuHour < 0 ||
        a.allocatedGpus > slot.capGpus - slot.usedGpus) return undefined;
    const power = a.allocatedGpus * site.kWhPerGpuHour;
    const plannedWork = Math.min(job.remainingGpuH, a.allocatedGpus * (interval[1] - interval[0]) / hour);
    const energy = plannedWork * site.kWhPerGpuHour;
    if (!near(a.requiredPowerKW, power) || !near(planned.estimatedKWh, energy) ||
        power > slot.availablePowerKW && !near(power, slot.availablePowerKW) ||
        energy > slot.availableEnergyKWh && !near(energy, slot.availableEnergyKWh)) return undefined;
    // Reject an unrepresentable final fraction before starting work, rather than stranding its remainder.
    const remainingDuration = job.remainingGpuH / a.allocatedGpus * hour;
    if (!near(remainingDuration, Math.round(remainingDuration))) return undefined;
    const duration = Math.min(interval[1] - interval[0], Math.round(remainingDuration));
    if (duration <= 0) return undefined;
    return { selection: structuredClone(selection), site,
        load: { id: allocationKey(selection), gpus: a.allocatedGpus, window: windowAt(interval[0], interval[0] + duration) } };
}
