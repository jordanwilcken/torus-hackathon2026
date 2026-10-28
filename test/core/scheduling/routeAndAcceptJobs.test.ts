import { expect, test } from "vitest";
import type { Job } from "../../../src/core/jobs/Job.type.js";
import type { SlotSnapshot } from "../../../src/core/energy/SlotSnapshot.type.js";
import type { SelectedJobOutcome } from "../../../src/core/scheduling/JobOutcome.type.js";
import { createEnergyMap } from "../../../src/core/energy/maps/createEnergyMap.js";
import { chooseExecutionSlot } from "../../../src/core/scheduling/chooseExecutionSlot.js";
import { routeAndAcceptJobs } from "../../../src/core/scheduling/routeAndAcceptJobs.js";

const now = "2026-10-27T12:00:00Z";
const currentHour = { startAt: now, endAt: "2026-10-27T13:00:00Z" };

function job(id: string, deadline = "2026-10-27T16:00:00Z"): Job {
    return {
        id, workloadRef: "batch-training", computeProfile: "gpu",
        window: { startAt: now, endAt: deadline },
        allowedLocations: ["utah"], homeLocation: "utah", currentLocation: "utah", readyAt: now,
        workGpuH: 2, remainingGpuH: 2, maxGpus: 2, dataGB: 0, state: "queued",
    };
}

function selected(job: Job): SelectedJobOutcome {
    return {
        selected: true, explanation: "Supplied current-slot selection.",
        allocation: {
            jobId: job.id, slot: { locationId: "utah", slotId: "utah-12" }, slotVersion: "v1",
            allocatedGpus: 2, kWhPerGpuHour: 1, requiredPowerKW: 2,
            energy: [{ window: { ...currentHour }, estimatedKWh: 2 }], forecast: {},
            postedUsdPerGpuHour: 0.06, priceBasis: "supplied energy and carbon price",
        },
    };
}

test("the earlier deadline gets two GPUs and acceptance leaves one for the next job", async () => {
    const queue = [job("later"), job("earlier", "2026-10-27T15:00:00Z")];
    const before = structuredClone(queue);
    const initial: SlotSnapshot = {
        status: "current", source: "supplied site capacity", version: "v1", observedAt: now,
        projected: false, simulated: true,
        slot: {
            id: "utah-12", locationId: "utah", window: { ...currentHour },
            capGpus: 3, usedGpus: 0, availablePowerKW: 3, availableEnergyKWh: 3,
            postedUsdPerGpuHour: 0.06, priceBasis: "supplied energy and carbon price",
        },
    };
    const afterFirstAcceptance: SlotSnapshot = {
        ...initial, version: "v2",
        slot: { ...initial.slot!, usedGpus: 2, availablePowerKW: 1, availableEnergyKWh: 1 },
    };
    const afterSecondAcceptance: SlotSnapshot = {
        ...initial, version: "v3",
        slot: { ...initial.slot!, usedGpus: 3, availablePowerKW: 0, availableEnergyKWh: 0 },
    };
    let reading = initial;
    const energy = createEnergyMap({
        window: queue[0].window,
        sites: [{ locationId: "utah", regionId: "PACE", computeProfile: "gpu" }],
    }, {
        siteEnergy: { slots: () => [reading] },
        regionalGrid: { read: () => ({ observations: [], forecast: {} }) },
    });
    const results = await routeAndAcceptJobs(queue, {
        route: submitted => chooseExecutionSlot(submitted, energy, {
            asOf: now, maximumAgeMinutes: 5, kWhPerGpuHour: 1,
            transferTo: () => undefined,
        }),
    }, {
        accept(selection) {
            if (selection.allocation.jobId === "earlier") {
                expect(selection.allocation).toMatchObject({ allocatedGpus: 2, slotVersion: "v1" });
                reading = afterFirstAcceptance;
            } else {
                expect(selection.allocation).toMatchObject({ allocatedGpus: 1, slotVersion: "v2" });
                reading = afterSecondAcceptance;
            }
            return true;
        },
    });

    expect(results).toMatchObject([
        { jobId: "earlier", selection: { selected: true, allocation: { allocatedGpus: 2, postedUsdPerGpuHour: 0.06 } }, accepted: true },
        { jobId: "later", selection: { selected: true, allocation: { allocatedGpus: 1, postedUsdPerGpuHour: 0.06 } }, accepted: true },
    ]);
    expect(reading).toBe(afterSecondAcceptance);
    expect(queue).toEqual(before);
});

test("equal deadlines use job ID order and leave the caller's queue unchanged", async () => {
    const queue = Object.freeze([job("z"), job("a"), job("Z"), job("m")]);
    const before = structuredClone(queue);
    const attempts: string[] = [];
    const results = await routeAndAcceptJobs(queue, {
        async route(submitted) {
            attempts.push(submitted.id);
            return { selected: false, explanation: "No available capacity." };
        },
    }, { accept: () => { throw new Error("Unselected jobs must not be accepted."); } });

    expect(attempts).toEqual(["Z", "a", "m", "z"]);
    expect(results.map(result => result.jobId)).toEqual(["Z", "a", "m", "z"]);
    expect(queue).toEqual(before);
});

test("an unselected explanation is returned without calling acceptance", async () => {
    const noSlot = { selected: false, explanation: "Protected energy is unavailable for compute." } as const;
    const results = await routeAndAcceptJobs([job("waiting")], {
        route: async () => noSlot,
    }, { accept: () => { throw new Error("No allocation exists to accept."); } });

    expect(results).toEqual([{ jobId: "waiting", selection: noSlot, accepted: false }]);
    expect(results[0].selection).toBe(noSlot);
});

test("rejected acceptance preserves the selection and the next job still gets a fresh attempt", async () => {
    const queue = [job("a"), job("b")];
    const before = structuredClone(queue);
    const selections = queue.map(selected);
    const events: string[] = [];
    const results = await routeAndAcceptJobs(queue, {
        async route(submitted) {
            events.push("route " + submitted.id);
            return selections.find(selection => selection.allocation.jobId === submitted.id)!;
        },
    }, {
        accept(selection) {
            events.push("accept " + selection.allocation.jobId);
            return selection.allocation.jobId === "b";
        },
    });

    expect(events).toEqual(["route a", "accept a", "route b", "accept b"]);
    expect(results).toEqual([
        { jobId: "a", selection: selections[0], accepted: false },
        { jobId: "b", selection: selections[1], accepted: true },
    ]);
    expect(queue).toEqual(before);
});

test("router and executor methods keep their receiver", async () => {
    const router = {
        explanation: "Wait for the next eligible slot.",
        async route(this: { explanation: string }) {
            return { selected: false as const, explanation: this.explanation };
        },
    };
    const executor = {
        available: true,
        accept(this: { available: boolean }) { return this.available; },
    };
    expect(await routeAndAcceptJobs([job("waiting")], router, executor)).toMatchObject([
        { selection: { selected: false, explanation: router.explanation }, accepted: false },
    ]);
    expect(await routeAndAcceptJobs([job("ready")], { route: async submitted => selected(submitted) }, executor))
        .toMatchObject([{ accepted: true }]);
});

test("dependency errors propagate instead of becoming an unselected outcome", async () => {
    const failure = new Error("Site provider disconnected.");
    await expect(routeAndAcceptJobs([job("ready")], {
        route: async () => { throw failure; },
    }, { accept: () => true })).rejects.toBe(failure);

    await expect(routeAndAcceptJobs([job("ready")], {
        route: async submitted => selected(submitted),
    }, { accept: () => { throw failure; } })).rejects.toBe(failure);
});

test("a later provider failure leaves earlier acceptances intact and stops the batch", async () => {
    const accepted: string[] = [];
    const attempted: string[] = [];
    const failure = new Error("Capacity source failed after the first acceptance.");
    await expect(routeAndAcceptJobs([job("a"), job("b"), job("c")], {
        async route(submitted) {
            attempted.push(submitted.id);
            if (submitted.id === "b") throw failure;
            return selected(submitted);
        },
    }, {
        accept(selection) {
            accepted.push(selection.allocation.jobId);
            return true;
        },
    })).rejects.toBe(failure);

    expect(accepted).toEqual(["a"]);
    expect(attempted).toEqual(["a", "b"]);
});

test("an empty queue performs no routing or acceptance", async () => {
    expect(await routeAndAcceptJobs([], {
        route: () => { throw new Error("There are no jobs to route."); },
    }, { accept: () => { throw new Error("There are no allocations to accept."); } })).toEqual([]);
});
