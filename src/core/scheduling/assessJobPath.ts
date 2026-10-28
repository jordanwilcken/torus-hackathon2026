import type { Job } from "../jobs/Job.type.js";
import type { EnergyMap } from "../energy/EnergyMap.interface.js";
import type { EnergySlot } from "../energy/EnergySlot.type.js";
import type { ExecutionSite } from "../execution/runner/Executor.types.js";
import type { SiteEnergyLoad } from "../energy/site/SiteEnergy.types.js";

export type JobPathAssessment = {
    feasible: false;
    reason: string;
} | {
    feasible: true;
    locationId: string;
    remainingGpuH: number;
    loads: SiteEnergyLoad[];
    completedAt: string;
    energyKWh: number;
    carbonKg: number | null;
    electricityUsd: number | null;
    postedChargeUsd: number;
    ledgerVersion: string;
};

type PathOptions = { asOf: string; maximumAgeMinutes: number; readyAt?: string };
type Candidate = { slot: EnergySlot; start: number; end: number };
const hour = 3_600_000;
const known = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value >= 0;

/** Conservative single-site heuristic, not an optimal schedule or a reservation.
 * Choose the cheapest fresh nonoverlapping offers that cover the remaining job, then
 * assess that complete chronological load plan with the physical ledger.
 * The final load rounds up to a millisecond so an estimate never omits remaining work.
 */
export function assessJobPath(job: Job, energyMap: EnergyMap, site: ExecutionSite, options: PathOptions): JobPathAssessment {
    const reject = (reason: string): JobPathAssessment => ({ feasible: false, reason });
    const now = Date.parse(options.asOf), deadline = Date.parse(job.window.endAt);
    const ready = Math.max(now, Date.parse(job.window.startAt), Date.parse(job.readyAt), Date.parse(options.readyAt ?? options.asOf));
    if (![now, deadline, ready, options.maximumAgeMinutes, site.kWhPerGpuHour, job.remainingGpuH].every(Number.isFinite)
        || options.maximumAgeMinutes < 0 || site.kWhPerGpuHour <= 0 || job.remainingGpuH <= 0
        || !Number.isInteger(job.maxGpus) || job.maxGpus <= 0 || ready >= deadline)
        return reject("The remaining job needs a valid ready time, deadline, freshness limit and compute profile.");
    if (job.state !== "queued" && job.state !== "running")
        return reject("Only queued or running remaining work can be assessed.");
    if (!job.allowedLocations.includes(site.locationId) || site.computeProfile !== job.computeProfile)
        return reject("The site is disallowed or does not support this job's compute profile.");

    const ledgerVersion = site.ledger.state().version;
    const candidates: Candidate[] = [];
    for (const reference of energyMap.findSlots({
        window: { startAt: new Date(ready).toISOString(), endAt: job.window.endAt },
        asOf: options.asOf, locations: [site.locationId], computeProfile: job.computeProfile,
    })) {
        if (reference.locationId !== site.locationId) continue;
        const snapshot = energyMap.readSlot(reference, options.asOf, options.maximumAgeMinutes);
        const slot = snapshot.slot;
        const age = (now - Date.parse(snapshot.observedAt ?? "")) / 60_000;
        if (snapshot.status !== "current" || !slot || !snapshot.version || snapshot.version !== ledgerVersion
            || slot.locationId !== site.locationId || slot.id !== reference.slotId
            || !Number.isFinite(age) || age < 0 || age > options.maximumAgeMinutes) continue;
        if (![slot.availablePowerKW, slot.availableEnergyKWh, slot.postedUsdPerGpuHour].every(known)
            || !Number.isInteger(slot.capGpus) || !Number.isInteger(slot.usedGpus)
            || slot.usedGpus < 0 || slot.capGpus < slot.usedGpus) continue;
        const start = Math.max(ready, Date.parse(slot.window.startAt));
        const end = Math.min(deadline, Date.parse(slot.window.endAt));
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) candidates.push({ slot, start, end });
    }
    candidates.sort((a, b) => a.slot.postedUsdPerGpuHour - b.slot.postedUsdPerGpuHour || a.start - b.start
        || a.end - b.end || a.slot.id.localeCompare(b.slot.id));

    const loads: SiteEnergyLoad[] = [];
    const occupied: Array<{ start: number; end: number }> = [];
    let remaining = job.remainingGpuH, postedChargeUsd = 0, expectedKWh = 0;
    for (const { slot, start, end } of candidates) {
        if (remaining <= 0) break;
        if (occupied.some(window => start < window.end && end > window.start)) continue;
        const gpus = Math.min(job.maxGpus, slot.capGpus - slot.usedGpus,
            Math.floor(slot.availablePowerKW / site.kWhPerGpuHour));
        if (gpus <= 0) continue;
        const milliseconds = Math.min(end - start,
            Math.floor(slot.availableEnergyKWh / (gpus * site.kWhPerGpuHour) * hour),
            Math.ceil(remaining / gpus * hour));
        if (milliseconds <= 0) continue;
        const workGpuH = gpus * milliseconds / hour;
        loads.push({
            id: "job-path:" + job.id + ":" + site.locationId + ":" + loads.length,
            window: { startAt: new Date(start).toISOString(), endAt: new Date(start + milliseconds).toISOString() },
            gpus,
        });
        remaining = Math.max(0, remaining - workGpuH);
        postedChargeUsd += workGpuH * slot.postedUsdPerGpuHour;
        expectedKWh += workGpuH * site.kWhPerGpuHour;
        // Do not spend another overlapping offer's copy of the same energy budget.
        occupied.push({ start, end });
    }
    if (remaining > 0 || loads.length === 0)
        return reject("Fresh nonoverlapping site offers cannot cover the whole remaining job before its deadline.");
    if (!known(postedChargeUsd) || !known(expectedKWh))
        return reject("The whole-job estimate exceeds finite numeric limits.");

    loads.sort((a, b) => Date.parse(a.window.startAt) - Date.parse(b.window.startAt));
    const assessment = site.ledger.assess(loads);
    if (!assessment.feasible) return reject(assessment.reason ?? "The physical ledger rejected the whole-job path.");
    if (assessment.version !== ledgerVersion || site.ledger.state().version !== ledgerVersion)
        return reject("The ledger revision changed while assessing the job path.");
    let energyKWh = 0;
    let carbonKg: number | null = 0, electricityUsd: number | null = 0;
    for (const load of loads) {
        const usage = assessment.usage[load.id];
        if (!usage || ![usage.solarKWh, usage.gridKWh, usage.batteryKWh].every(known))
            return reject("The physical assessment did not supply complete job energy usage.");
        energyKWh += usage.solarKWh + usage.gridKWh + usage.batteryKWh;
        carbonKg = carbonKg !== null && known(usage.carbonKg) ? carbonKg + usage.carbonKg : null;
        electricityUsd = electricityUsd !== null && known(usage.electricityUsd) ? electricityUsd + usage.electricityUsd : null;
    }
    if (!known(energyKWh) || Math.abs(energyKWh - expectedKWh) > Math.max(1e-8, expectedKWh * 1e-8))
        return reject("The physical assessment does not account for the whole remaining job's energy.");
    return {
        feasible: true, locationId: site.locationId, remainingGpuH: job.remainingGpuH, loads,
        completedAt: loads.at(-1)!.window.endAt, energyKWh,
        carbonKg: carbonKg !== null && Number.isFinite(carbonKg) ? carbonKg : null,
        electricityUsd: electricityUsd !== null && Number.isFinite(electricityUsd) ? electricityUsd : null,
        postedChargeUsd, ledgerVersion,
    };
}
