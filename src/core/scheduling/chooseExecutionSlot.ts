import type { Job } from "../jobs/Job.type.js";
import type { EnergyMap } from "../energy/EnergyMap.interface.js";
import type { EnergySlot } from "../energy/EnergySlot.type.js";
import type { SlotReference } from "../energy/SlotReference.type.js";
import type { JobOutcome } from "./JobOutcome.type.js";
import {
    minimumRunHours, powerLimitedGpus, energyLimitedGpus, slotUsage, priceWithTransfer, exceeds,
} from "./math/chooseExecutionSlot.generated.js";

type SlotRoutingOptions = {
    asOf: string;
    maximumAgeMinutes: number;
    kWhPerGpuHour: number;
    transferTo: (locationId: string) => { hours: number; costUsd: number } | undefined;
};

type SlotChoice = {
    reference: SlotReference;
    slot: EnergySlot;
    version: string;
    canExecuteNow: boolean;
    start: number;
    end: number;
    allocatedGpus: number;
    workGpuH: number;
    requiredPowerKW: number;
    estimatedKWh: number;
    priceWithTransfer: number;
};

type SlotCapacity = Parameters<typeof powerLimitedGpus>[0] & { availableEnergyKWh: number };

type SlotReadContext = Pick<SlotRoutingOptions, "asOf" | "maximumAgeMinutes"> & { now: number };

type FreshSlot = {
    slot: EnergySlot;
    version: string;
    projected: boolean;
    start: number;
    end: number;
};

type Transfer = NonNullable<ReturnType<SlotRoutingOptions["transferTo"]>>;

const hour = 3_600_000;

export async function chooseExecutionSlot(
    job: Job, energyMap: EnergyMap, options: SlotRoutingOptions,
): Promise<JobOutcome> {
    const now = Date.parse(options.asOf);
    const deadline = Date.parse(job.window.endAt);
    const ready = Math.max(Date.parse(job.readyAt), Date.parse(job.window.startAt));
    if (!Number.isFinite(now) || !Number.isFinite(deadline) || !Number.isFinite(ready) ||
        !Number.isFinite(options.maximumAgeMinutes) || options.maximumAgeMinutes < 0 ||
        !Number.isFinite(options.kWhPerGpuHour) || options.kWhPerGpuHour <= 0) {
        return { selected: false, explanation: "Routing needs a valid current time, freshness limit and positive compute energy profile." };
    }
    if (job.state !== "queued" && job.state !== "running") {
        return { selected: false, explanation: "A " + job.state + " job cannot receive a current allocation." };
    }
    if (ready > now) return { selected: false, explanation: "The job is not ready to execute yet." };
    if (!Number.isInteger(job.maxGpus) || job.maxGpus <= 0 ||
        !Number.isFinite(job.remainingGpuH) || job.remainingGpuH <= 0 || now >= deadline) {
        return { selected: false, explanation: "The job has no remaining ready work within a valid deadline and GPU limit." };
    }
    const minimumHours = minimumRunHours({ remainingGpuH: job.remainingGpuH, maxGpus: job.maxGpus });
    if (minimumHours > (deadline - now) / hour) {
        return { selected: false, explanation: "The remaining work cannot finish before the deadline within the job's GPU limit." };
    }

    const choices: SlotChoice[] = [];
    const transferReasons: string[] = [];
    const slotReadContext: SlotReadContext = {
        asOf: options.asOf, maximumAgeMinutes: options.maximumAgeMinutes, now,
    };
    const references = energyMap.findSlots({
        window: { startAt: options.asOf, endAt: job.window.endAt }, asOf: options.asOf,
        locations: job.allowedLocations, computeProfile: job.computeProfile,
    });
    for (const reference of references) {
        if (!job.allowedLocations.includes(reference.locationId)) continue;
        const source = readFreshSlot(energyMap, reference, slotReadContext);
        if (!source) continue;
        const { slot, start: slotStart, end: slotEnd } = source;
        const transfer = readTransfer(job.currentLocation, reference.locationId, options);
        if (!transfer) {
            transferReasons.push("Transfer assumptions for " + reference.locationId + " are unavailable.");
            continue;
        }
        if (transfer.hours + minimumHours > (deadline - now) / hour) {
            transferReasons.push("Transfer to " + reference.locationId + " plus the remaining work would miss the deadline.");
            continue;
        }
        if (transfer.hours > 0) {
            transferReasons.push("A transfer to " + reference.locationId + " is required before a current allocation can execute.");
        }
        const start = Math.max(now + transfer.hours * hour, slotStart);
        const end = Math.min(slotEnd, deadline, start + hour);
        const durationHours = (end - start) / hour;
        if (durationHours <= 0) continue;
        const capacity: SlotCapacity = {
            maxGpus: job.maxGpus, capGpus: slot.capGpus, usedGpus: slot.usedGpus,
            availablePowerKW: slot.availablePowerKW, availableEnergyKWh: slot.availableEnergyKWh,
            remainingGpuH: job.remainingGpuH, durationHours, kWhPerGpuHour: options.kWhPerGpuHour,
        };
        const initialGpus = powerLimitedGpus(capacity);
        const allocatedGpus = energyLimitedGpus({ ...capacity, initialGpus });
        if (!Number.isInteger(allocatedGpus) || allocatedGpus <= 0) continue;
        const [workGpuH, requiredPowerKW, estimatedKWh] = slotUsage({ ...capacity, allocatedGpus });
        const canExecuteNow = start === now && !source.projected;
        const missesCurrentDeadline = canExecuteNow && exceeds({
            value: job.remainingGpuH - workGpuH, limit: job.maxGpus * (deadline - end) / hour,
        });
        if (missesCurrentDeadline) continue;
        const effectivePrice = priceWithTransfer({
            postedUsdPerGpuHour: slot.postedUsdPerGpuHour,
            transferCostUsd: transfer.costUsd, remainingGpuH: job.remainingGpuH,
        });
        if (!Number.isFinite(effectivePrice) || effectivePrice < 0) continue;
        choices.push({
            reference, slot, version: source.version, canExecuteNow,
            start, end, allocatedGpus, workGpuH, requiredPowerKW, estimatedKWh,
            priceWithTransfer: effectivePrice,
        });
    }

    const current = choices.filter(choice => choice.canExecuteNow)
        .sort((a, b) => a.priceWithTransfer - b.priceWithTransfer ||
            a.reference.locationId.localeCompare(b.reference.locationId) ||
            a.reference.slotId.localeCompare(b.reference.slotId))[0];
    if (!current) return {
        selected: false,
        explanation: transferReasons[0] ?? "This policy found no current, non-projected slot with usable capacity.",
    };
    const hoursNeeded = Math.ceil(minimumHours);
    const slackHours = (deadline - now) / hour - hoursNeeded;
    if (slackHours > 1) {
        const futureSite = cheaperFutureSite(job, choices, current.priceWithTransfer, now, hoursNeeded + 1);
        if (futureSite) return {
            selected: false,
            explanation: "Waiting: supplied cheaper future slots at " + futureSite +
                " cover the remaining work under this policy. Future capacity is not reserved.",
        };
    }

    return {
        selected: true,
        allocation: {
            jobId: job.id, slot: { ...current.reference }, slotVersion: current.version,
            allocatedGpus: current.allocatedGpus, kWhPerGpuHour: options.kWhPerGpuHour,
            requiredPowerKW: current.requiredPowerKW,
            energy: [{
                window: { startAt: new Date(current.start).toISOString(), endAt: new Date(current.end).toISOString() },
                estimatedKWh: current.estimatedKWh,
            }],
            forecast: structuredClone(energyMap.readForecast(current.reference, options.asOf)),
            postedUsdPerGpuHour: current.slot.postedUsdPerGpuHour, priceBasis: current.slot.priceBasis,
        },
        explanation: "Selected " + current.reference.locationId + " at its posted " +
            current.slot.postedUsdPerGpuHour + " USD/GPU-hour. Capacity still requires acceptance.",
    };
}

function readFreshSlot(
    energyMap: EnergyMap, reference: SlotReference, context: SlotReadContext,
): FreshSlot | undefined {
    const snapshot = energyMap.readSlot(reference, context.asOf, context.maximumAgeMinutes);
    const slot = snapshot.slot;
    const ageMinutes = (context.now - Date.parse(snapshot.observedAt ?? "")) / 60_000;
    if (snapshot.status !== "current" || !slot || !snapshot.version?.trim() ||
        slot.locationId !== reference.locationId || slot.id !== reference.slotId ||
        !Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > context.maximumAgeMinutes) return undefined;
    if (![slot.availablePowerKW, slot.availableEnergyKWh].every(value => Number.isFinite(value) && value >= 0) ||
        !Number.isInteger(slot.capGpus) || !Number.isInteger(slot.usedGpus) ||
        slot.usedGpus < 0 || slot.capGpus < slot.usedGpus) return undefined;
    const start = Date.parse(slot.window.startAt);
    const end = Date.parse(slot.window.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= context.now) return undefined;
    return { slot, version: snapshot.version, projected: snapshot.projected, start, end };
}

function readTransfer(
    currentLocation: string, locationId: string, options: SlotRoutingOptions,
): Transfer | undefined {
    if (currentLocation === locationId) return { hours: 0, costUsd: 0 };
    const transfer = options.transferTo(locationId);
    return transfer && [transfer.hours, transfer.costUsd].every(value => Number.isFinite(value) && value >= 0)
        ? transfer : undefined;
}

function cheaperFutureSite(
    job: Job, choices: SlotChoice[], currentPrice: number, now: number, bufferedHours: number,
): string | undefined {
    const future = choices.filter(choice => choice.start > now &&
        Math.floor(choice.start / hour) > Math.floor(now / hour) && choice.priceWithTransfer < currentPrice);
    for (const locationId of new Set(future.map(choice => choice.reference.locationId))) {
        const sameSite = future.filter(choice => choice.reference.locationId === locationId)
            .sort((a, b) => a.start - b.start || a.end - b.end || a.priceWithTransfer - b.priceWithTransfer);
        let through = now;
        let knownWork = 0;
        const cheaperHours = new Set<number>();
        for (const choice of sameSite) {
            if (choice.start < through) continue;
            through = choice.end;
            knownWork += choice.workGpuH;
            cheaperHours.add(Math.floor(choice.start / hour));
        }
        if (knownWork >= job.remainingGpuH && cheaperHours.size >= bufferedHours) return locationId;
    }
    return undefined;
}
