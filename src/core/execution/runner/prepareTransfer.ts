import type { Job } from "../../jobs/Job.type.js";
import type { SlotSnapshot } from "../../energy/SlotSnapshot.type.js";
import type { StartedTransfer, TransferOutcome } from "../TransferOutcome.type.js";
import type { ExecutionSite, TransferTerms } from "./Executor.types.js";
import { bounds, near } from "./executionTime.js";
import * as time from "./math/time.generated.js";
import * as work from "./math/execution.generated.js";
import * as transfer from "./math/transfer.generated.js";

/** Known future capacity is a necessary check, never an acceptance or future reservation. */
export function prepareTransfer(job: Job, destination: ExecutionSite, startsAt: string, terms: TransferTerms,
    grid: { origin: number; duration: number }, maximumAgeMinutes: number): TransferOutcome {
    const reject = (explanation: string): TransferOutcome => ({ started: false, explanation });
    if (!terms.accountingBasis || terms.accountingBasis !== destination.accountingBasis ||
        !Number.isFinite(terms.bandwidthGBPerHour) || terms.bandwidthGBPerHour <= 0 ||
        [terms.kWhPerGB, terms.jobChargeUsdPerGB, terms.carbonGPerKWh ?? 0, terms.electricityUsdPerMWh ?? 0]
            .some(n => !Number.isFinite(n) || n < 0)) return reject("Transfer terms are incomplete or incompatible.");

    const start = Date.parse(startsAt), deadline = Date.parse(job.window.endAt);
    const transferHours = transfer.transferHours({ dataGB: job.dataGB, bandwidthGBPerHour: terms.bandwidthGBPerHour });
    const durationMs = time.millisecondsForHours({ durationHours: transferHours });
    const arrival = time.timeAfter({ start, durationMs });
    const ready = transfer.gridReadyTime({ origin: grid.origin, arrival, tickMs: grid.duration });
    const energyKWh = transfer.transferEnergy({ dataGB: job.dataGB, kWhPerGB: terms.kWhPerGB });
    const jobChargeUsd = transfer.transferCharge({ dataGB: job.dataGB, usdPerGB: terms.jobChargeUsdPerGB });
    const carbonKg = energyKWh === 0 ? 0 : terms.carbonGPerKWh === undefined ? undefined :
        transfer.carbonKilograms({ energyKWh, gramsPerKWh: terms.carbonGPerKWh });
    const electricityUsd = energyKWh === 0 ? 0 : terms.electricityUsdPerMWh === undefined ? undefined :
        transfer.electricityDollars({ energyKWh, usdPerMWh: terms.electricityUsdPerMWh });
    const minimumWorkHours = work.requiredHours({ remainingGpuH: job.remainingGpuH, gpus: job.maxGpus });
    const minimumWorkMs = time.millisecondsForHours({ durationHours: minimumWorkHours });
    const timeLeftMs = time.elapsedMilliseconds({ start: ready, end: deadline });
    if (![ready, energyKWh, jobChargeUsd, carbonKg ?? 0, electricityUsd ?? 0].every(Number.isFinite) ||
        ready >= deadline || minimumWorkMs > timeLeftMs)
        return reject("Transfer and remaining work cannot finish before the deadline.");

    const readyAt = new Date(ready).toISOString();
    const candidates = destination.ledger.slots(destination.locationId, { startAt: readyAt, endAt: job.window.endAt });
    const capacity = freshDestinationCapacity(candidates, start, maximumAgeMinutes);
    const availableWork = knownDestinationWork(capacity, {
        readyAt: ready, deadline, maxGpus: job.maxGpus, kWhPerGpuHour: destination.kWhPerGpuHour,
    });
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

type DestinationCapacity = {
    start: number;
    end: number;
    capGpus: number;
    usedGpus: number;
    availablePowerKW: number;
    availableEnergyKWh: number;
};

/** Keep publication evidence at the selection boundary; retain provider iteration order. */
function freshDestinationCapacity(candidates: readonly SlotSnapshot[], at: number, maximumAgeMinutes: number): DestinationCapacity[] {
    const capacity: DestinationCapacity[] = [];
    for (const snapshot of candidates) {
        const slot = snapshot.slot, interval = bounds(slot?.window), observed = Date.parse(snapshot.observedAt ?? "");
        if (!slot || !interval || snapshot.status !== "current" || !snapshot.version || !snapshot.source ||
            !Number.isFinite(observed) || observed > at || time.ageMinutes({ at, observedAt: observed }) > maximumAgeMinutes) continue;
        capacity.push({ start: interval[0], end: interval[1], capGpus: slot.capGpus, usedGpus: slot.usedGpus,
            availablePowerKW: slot.availablePowerKW, availableEnergyKWh: slot.availableEnergyKWh });
    }
    return capacity;
}

/** Capacity calculation receives only the selected numeric windows and execution requirements. */
function knownDestinationWork(capacity: readonly DestinationCapacity[], execution: {
    readyAt: number; deadline: number; maxGpus: number; kWhPerGpuHour: number;
}): number {
    let availableWork = 0;
    for (const slot of capacity) {
        const activeHours = transfer.activeHours({ deadline: execution.deadline, slotEnd: slot.end,
            readyAt: execution.readyAt, slotStart: slot.start });
        const powerGpus = transfer.powerSupportedGpus({ availablePowerKW: slot.availablePowerKW, kWhPerGpuHour: execution.kWhPerGpuHour });
        const gpus = transfer.destinationGpus({ maxGpus: execution.maxGpus,
            unreservedGpus: work.unreservedGpus({ capacity: slot.capGpus, used: slot.usedGpus }),
            powerGpus: transfer.wholePowerGpus({ powerGpus }) });
        const slotGpuH = transfer.slotWork({ gpus, activeHours,
            availableEnergyKWh: slot.availableEnergyKWh, kWhPerGpuHour: execution.kWhPerGpuHour });
        availableWork = transfer.accumulatedWork({ previousGpuH: availableWork, slotGpuH });
    }
    return availableWork;
}
