import type { Job } from "../../jobs/Job.type.js";
import type { StartedTransfer, TransferOutcome } from "../TransferOutcome.type.js";
import type { ExecutionSite, TransferTerms } from "./Executor.types.js";
import { bounds, hour, near } from "./executionTime.js";

/** Known future capacity is a necessary check, never an acceptance or future reservation. */
export function prepareTransfer(job: Job, destination: ExecutionSite, startsAt: string, terms: TransferTerms,
    grid: { origin: number; duration: number }, maximumAgeMinutes: number): TransferOutcome {
    const reject = (explanation: string): TransferOutcome => ({ started: false, explanation });
    if (!terms.accountingBasis || terms.accountingBasis !== destination.accountingBasis ||
        !Number.isFinite(terms.bandwidthGBPerHour) || terms.bandwidthGBPerHour <= 0 ||
        [terms.kWhPerGB, terms.jobChargeUsdPerGB, terms.carbonGPerKWh ?? 0, terms.electricityUsdPerMWh ?? 0]
            .some(n => !Number.isFinite(n) || n < 0)) return reject("Transfer terms are incomplete or incompatible.");
    const start = Date.parse(startsAt), deadline = Date.parse(job.window.endAt);
    const duration = job.dataGB / terms.bandwidthGBPerHour * hour;
    const ready = grid.origin + Math.ceil((start + duration - grid.origin) / grid.duration) * grid.duration;
    const energyKWh = job.dataGB * terms.kWhPerGB, jobChargeUsd = job.dataGB * terms.jobChargeUsdPerGB;
    const carbonKg = energyKWh === 0 ? 0 : terms.carbonGPerKWh === undefined ? undefined : energyKWh * terms.carbonGPerKWh / 1000;
    const electricityUsd = energyKWh === 0 ? 0 : terms.electricityUsdPerMWh === undefined ? undefined : energyKWh * terms.electricityUsdPerMWh / 1000;
    if (![ready, energyKWh, jobChargeUsd, carbonKg ?? 0, electricityUsd ?? 0].every(Number.isFinite) ||
        ready >= deadline || job.remainingGpuH / job.maxGpus * hour > deadline - ready)
        return reject("Transfer and remaining work cannot finish before the deadline.");
    const readyAt = new Date(ready).toISOString();
    const candidates = destination.ledger.slots(destination.locationId, { startAt: readyAt, endAt: job.window.endAt });
    let availableWork = 0;
    for (const snapshot of candidates) {
        const slot = snapshot.slot, interval = bounds(slot?.window), observed = Date.parse(snapshot.observedAt ?? "");
        if (!slot || !interval || snapshot.status !== "current" || !snapshot.version || !snapshot.source ||
            !Number.isFinite(observed) || observed > start || (start - observed) / 60_000 > maximumAgeMinutes) continue;
        const activeHours = Math.max(0, Math.min(deadline, interval[1]) - Math.max(ready, interval[0])) / hour;
        const powerGpus = slot.availablePowerKW / destination.kWhPerGpuHour;
        const integralPowerGpus = Math.floor(near(powerGpus, Math.round(powerGpus)) ? Math.round(powerGpus) : powerGpus);
        const gpus = Math.min(job.maxGpus, slot.capGpus - slot.usedGpus, integralPowerGpus);
        availableWork += Math.min(gpus * activeHours, slot.availableEnergyKWh / destination.kWhPerGpuHour);
    }
    if (availableWork < job.remainingGpuH && !near(availableWork, job.remainingGpuH))
        return reject("Known destination capacity cannot support the remaining work; future capacity is not reserved.");
    const result: StartedTransfer = {
        started: true, readyAt,
        evidence: {
            id: JSON.stringify([job.id, destination.locationId, start]), jobId: job.id,
            fromLocation: job.currentLocation, toLocation: destination.locationId,
            window: { startAt: startsAt, endAt: readyAt }, energyKWh, accountingBasis: terms.accountingBasis,
            carbonKg, electricityUsd, jobChargeUsd,
        },
        explanation: "Transfer started with preserved progress. Arrival requires a fresh current allocation.",
    };
    return result;
}
