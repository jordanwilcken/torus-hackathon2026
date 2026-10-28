import type { Router } from "../../../src/core/scheduling/Router.interface.js";
import { route } from "../../../src/core/scheduling/route.js";
import { expect, test } from "vitest";
import type { Job } from "../../../src/core/jobs/Job.type.js";
import type { EnergyMap } from "../../../src/core/energy/EnergyMap.interface.js";
import type { SlotSnapshot } from "../../../src/core/energy/SlotSnapshot.type.js";
import type { SlotForecast } from "../../../src/core/energy/SlotForecast.type.js";
import { chooseExecutionSlot } from "../../../src/core/scheduling/chooseExecutionSlot.js";
import { floorWholeUnits, exceeds } from "../../../src/core/scheduling/chooseExecutionSlot.generated.js";
import { createSimulation } from "../../../src/core/execution/simulation/clock.js";
import { createEnergyMap } from "../../../src/core/energy/maps/createEnergyMap.js";
import type { JobOutcome } from "../../../src/core/scheduling/JobOutcome.type.js";

const now = "2026-10-27T12:00:00Z";
const currentHour = { startAt: now, endAt: "2026-10-27T13:00:00Z" };

function job(changes: Partial<Job> = {}): Job {
    return {
        id: "training", workloadRef: "batch-training", computeProfile: "gpu",
        window: { startAt: now, endAt: "2026-10-27T16:00:00Z" },
        allowedLocations: ["A", "B"], homeLocation: "A", currentLocation: "A", readyAt: now,
        workGpuH: 1, remainingGpuH: 1, maxGpus: 1, dataGB: 1, state: "queued", ...changes,
    };
}

function slot(locationId: string, price: number, changes: Partial<NonNullable<SlotSnapshot["slot"]>> = {}): SlotSnapshot {
    return {
        status: "current", source: "supplied site capacity", version: "version-1", observedAt: now,
        projected: false, simulated: true,
        slot: {
            id: locationId + "-12", locationId, window: { ...currentHour },
            availablePowerKW: 8, availableEnergyKWh: 8, capGpus: 8, usedGpus: 0,
            postedUsdPerGpuHour: price, priceBasis: "energy and modeled carbon", ...changes,
        },
    };
}

function map(readings: SlotSnapshot[], forecasts: Record<string, SlotForecast> = {}): EnergyMap {
    return {
        findSlots: () => readings.map(reading => ({ locationId: reading.slot!.locationId, slotId: reading.slot!.id })),
        readSlot: reference => readings.find(reading => reading.slot?.locationId === reference.locationId &&
            reading.slot.id === reference.slotId)!,
        readForecast: reference => forecasts[reference.locationId] ?? {},
    };
}

function options(changes: Partial<Parameters<typeof chooseExecutionSlot>[2]> = {}): Parameters<typeof chooseExecutionSlot>[2] {
    return {
        asOf: now, maximumAgeMinutes: 5, kWhPerGpuHour: 1,
        transferTo: () => ({ hours: 0, costUsd: 0 }), ...changes,
    };
}

test("chooses the cheaper eligible posted slot and retains its forecast without completing or reserving work", async () => {
    const submitted = job();
    const readings = [slot("A", 0.09), slot("B", 0.06)];
    const forecast: SlotForecast = { carbon: {
        source: "supplied region B forecast", scope: "region B", basis: "average operational CO2",
        unit: "gCO2/kWh", issuedAt: now, retrievedAt: now, simulated: true,
        points: [{ window: { ...currentHour }, value: 100 }],
    } };
    const before = structuredClone({ submitted, readings, forecast });
    const outcome = await chooseExecutionSlot(submitted, map(readings, { B: forecast }), options());

    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error(outcome.explanation);
    expect(outcome.allocation).toMatchObject({
        jobId: "training", slot: { locationId: "B", slotId: "B-12" }, slotVersion: "version-1",
        allocatedGpus: 1, postedUsdPerGpuHour: 0.06, priceBasis: "energy and modeled carbon",
        forecast,
    });
    expect({ submitted, readings, forecast }).toEqual(before);
    outcome.allocation.forecast.carbon!.points[0].value = 999;
    expect(forecast.carbon!.points[0].value).toBe(100);
});

test("eight total GPUs with seven reserved permits one GPU and no reservation mutation", async () => {
    const reading = slot("A", 0.09, { capGpus: 8, usedGpus: 7 });
    const submitted = job({ workGpuH: 8, remainingGpuH: 8, maxGpus: 8 });
    const outcome = await chooseExecutionSlot(submitted, map([reading]), options());
    expect(outcome).toMatchObject({ selected: true, allocation: { allocatedGpus: 1, requiredPowerKW: 1 } });
    expect(reading.slot!.usedGpus).toBe(7);
    expect(submitted.remainingGpuH).toBe(8);
});

test("zero discretionary energy cannot be bypassed by a free posted price or an urgent deadline", async () => {
    const submitted = job({ window: { ...currentHour } });
    const outcome = await chooseExecutionSlot(submitted, map([
        slot("A", 0, { availableEnergyKWh: 0, availablePowerKW: 1 }),
    ]), options());
    expect(outcome.selected).toBe(false);
    expect(submitted.remainingGpuH).toBe(1);
});

test("the final quarter GPU-hour needs quarter kWh but still needs one full GPU of active power", async () => {
    const submitted = job({ workGpuH: 0.25, remainingGpuH: 0.25, maxGpus: 8 });
    const enoughPower = slot("A", 0.09, { availableEnergyKWh: 0.25, availablePowerKW: 1 });
    const outcome = await chooseExecutionSlot(submitted, map([enoughPower]), options());
    expect(outcome).toMatchObject({
        selected: true, allocation: {
            allocatedGpus: 1, requiredPowerKW: 1,
            energy: [{ estimatedKWh: 0.25 }],
        },
    });
    expect((await chooseExecutionSlot(submitted, map([
        slot("A", 0.09, { availableEnergyKWh: 0.25, availablePowerKW: 0.25 }),
    ]), options())).selected).toBe(false);
});

test("stale, projected, mismatched and unversioned readings never authorize current execution", async () => {
    const stale = slot("A", 0);
    stale.status = "stale";
    const projected = slot("A", 0);
    projected.projected = true;
    const unversioned = slot("A", 0);
    delete unversioned.version;
    const old = slot("A", 0);
    old.observedAt = "2026-10-27T11:54:00Z";
    for (const reading of [stale, projected, unversioned, old]) {
        expect((await chooseExecutionSlot(job(), map([reading]), options())).selected).toBe(false);
    }
    const mismatched = map([slot("A", 0)]);
    mismatched.readSlot = () => slot("B", 0);
    expect((await chooseExecutionSlot(job(), mismatched, options())).selected).toBe(false);
});

test("only allowed locations participate and absent carbon evidence stays absent", async () => {
    const outcome = await chooseExecutionSlot(job({ allowedLocations: ["A"] }),
        map([slot("A", 0.09), slot("B", 0)]), options());
    expect(outcome).toMatchObject({ selected: true, allocation: { slot: { locationId: "A" }, forecast: {} } });
    if (!outcome.selected) throw new Error(outcome.explanation);
    expect(outcome.allocation.forecast.carbon).toBeUndefined();
});

test("moving, paused, done, missed and not-yet-ready jobs receive no current allocation", async () => {
    for (const state of ["moving", "paused", "done", "missed"] as const) {
        expect((await chooseExecutionSlot(job({ state }), map([slot("A", 0.09)]), options())).selected).toBe(false);
    }
    expect((await chooseExecutionSlot(job({ readyAt: "2026-10-27T12:30:00Z" }),
        map([slot("A", 0.09)]), options())).selected).toBe(false);
    expect((await chooseExecutionSlot(job({ state: "running" }),
        map([slot("A", 0.09)]), options())).selected).toBe(true);
});

test("a remote choice requires declared transfer assumptions and cannot execute during a positive transfer", async () => {
    const readings = map([slot("B", 0)]);
    const unknown = await chooseExecutionSlot(job(), readings, options({ transferTo: () => undefined }));
    expect(unknown.selected).toBe(false);
    expect(unknown.explanation).toContain("unavailable");

    const travelling = await chooseExecutionSlot(job(), readings,
        options({ transferTo: () => ({ hours: 0.5, costUsd: 0.01 }) }));
    expect(travelling.selected).toBe(false);
    expect(travelling.explanation).toContain("transfer");

    const immediate = await chooseExecutionSlot(job(), readings,
        options({ transferTo: () => ({ hours: 0, costUsd: 0.01 }) }));
    expect(immediate).toMatchObject({ selected: true, allocation: { slot: { locationId: "B" } } });
});

test("transfer plus minimum remaining execution beyond the deadline explains why no remote slot is selected", async () => {
    const outcome = await chooseExecutionSlot(job({ window: { ...currentHour } }), map([slot("B", 0)]),
        options({ transferTo: () => ({ hours: 0.5, costUsd: 0 }) }));
    expect(outcome.selected).toBe(false);
    expect(outcome.explanation).toContain("deadline");
});

test("one-time transfer overhead can make the lower posted remote price a worse choice", async () => {
    const outcome = await chooseExecutionSlot(job(), map([slot("A", 0.09), slot("B", 0.06)]),
        options({ transferTo: () => ({ hours: 0, costUsd: 0.04 }) }));
    expect(outcome).toMatchObject({ selected: true, allocation: { slot: { locationId: "A" }, postedUsdPerGpuHour: 0.09 } });
});

function futureSlot(locationId: string, startHour: number, price: number, durationHours = 1): SlotSnapshot {
    const start = Date.parse(now) + (startHour - 12) * 3_600_000;
    const reading = slot(locationId, price, {
        id: locationId + "-" + startHour,
        window: { startAt: new Date(start).toISOString(), endAt: new Date(start + durationHours * 3_600_000).toISOString() },
        availablePowerKW: 1, availableEnergyKWh: durationHours, capGpus: 1,
    });
    reading.projected = true;
    return reading;
}

test("with slack, two cheaper known future hours can advise waiting for one GPU-hour without reserving them", async () => {
    const future = [futureSlot("A", 13, 0.02), futureSlot("A", 14, 0.01)];
    const before = structuredClone(future);
    const outcome = await chooseExecutionSlot(job(), map([slot("A", 0.09), ...future]), options());
    expect(outcome.selected).toBe(false);
    expect(outcome.explanation).toContain("Waiting");
    expect(outcome.explanation).toContain("not reserved");
    expect(future).toEqual(before);
});

test("urgency, a missing future or only one cheaper hour keeps a usable current slot eligible", async () => {
    const nowSlot = slot("A", 0.09);
    expect((await chooseExecutionSlot(job({ window: { startAt: now, endAt: "2026-10-27T14:00:00Z" } }),
        map([nowSlot, futureSlot("A", 13, 0.01)]), options())).selected).toBe(true);
    expect((await chooseExecutionSlot(job(), map([nowSlot]), options())).selected).toBe(true);
    expect((await chooseExecutionSlot(job(), map([nowSlot, futureSlot("A", 13, 0.01)]), options())).selected).toBe(true);
});

test("stale future prices and projections before transfer arrival cannot justify waiting", async () => {
    const oldFuture = futureSlot("A", 13, 0);
    oldFuture.status = "stale";
    expect((await chooseExecutionSlot(job(), map([
        slot("A", 0.09), oldFuture, futureSlot("A", 14, 0),
    ]), options())).selected).toBe(true);

    expect((await chooseExecutionSlot(job(), map([
        slot("A", 0.09), futureSlot("B", 13, 0), futureSlot("B", 14, 0),
    ]), options({ transferTo: () => ({ hours: 3, costUsd: 0 }) }))).selected).toBe(true);
});

test("duplicate overlapping future offers cannot turn two known GPU-hours into the three needed to wait", async () => {
    const future = [13, 14, 15, 16].flatMap(startHour => {
        const original = futureSlot("A", startHour, 0.01, 0.5);
        const duplicate = structuredClone(original);
        duplicate.slot!.id += "-duplicate";
        return [original, duplicate];
    });
    const outcome = await chooseExecutionSlot(job({
        workGpuH: 3, remainingGpuH: 3,
        window: { startAt: now, endAt: "2026-10-27T18:00:00Z" },
    }), map([slot("A", 0.09), ...future]), options());
    expect(outcome.selected).toBe(true);
});

test("waiting requires one future site path, not the sum of separate sites' limited hours", async () => {
    const outcome = await chooseExecutionSlot(job({
        workGpuH: 3, remainingGpuH: 3,
        window: { startAt: now, endAt: "2026-10-27T18:00:00Z" },
    }), map([
        slot("A", 0.09), futureSlot("A", 13, 0.01), futureSlot("A", 14, 0.01),
        futureSlot("B", 15, 0.01), futureSlot("B", 16, 0.01),
    ]), options());
    expect(outcome.selected).toBe(true);
});

test("the existing route boundary can use this selector directly without a Fake router", async () => {
    const readings = map([slot("A", 0.09), slot("B", 0.06)]);
    const submitted = job();
    const router: Router = { route: currentJob => chooseExecutionSlot(currentJob, readings, options()) };
    const expected = await chooseExecutionSlot(submitted, readings, options());

    expect(await route(submitted, router)).toEqual(expected);
    expect(submitted.remainingGpuH).toBe(1);
});

test("a cheap one-GPU final-hour slot is rejected when four required GPU-hours can finish at the four-GPU site", async () => {
    const submitted = job({
        workGpuH: 4, remainingGpuH: 4, maxGpus: 4, window: { ...currentHour },
    });
    const cheap = slot("A", 0.01, { capGpus: 1, availablePowerKW: 1, availableEnergyKWh: 1 });
    const enough = slot("B", 0.09, { capGpus: 4, availablePowerKW: 4, availableEnergyKWh: 4 });
    expect(await chooseExecutionSlot(submitted, map([cheap, enough]), options()))
        .toMatchObject({ selected: true, allocation: { slot: { locationId: "B" }, allocatedGpus: 4 } });
    expect((await chooseExecutionSlot(submitted, map([cheap]), options())).selected).toBe(false);
});

test("unknown or invalid current capacity never authorizes an allocation", async () => {
    const changes = [
        { availableEnergyKWh: Number.NaN }, { availablePowerKW: Infinity },
        { availablePowerKW: -1 }, { availableEnergyKWh: -1 },
        { capGpus: 1.5 }, { usedGpus: 0.5 }, { capGpus: 1, usedGpus: 2 },
    ];
    for (const change of changes) {
        const outcome = await chooseExecutionSlot(job(), map([slot("A", 0.01, change)]), options());
        expect(outcome.selected, JSON.stringify(change)).toBe(false);
    }
});

test("three GPUs at 0.1 kWh per GPU-hour fit 0.3 kW and 0.3 kWh despite binary64 rounding", async () => {
    const outcome = await chooseExecutionSlot(job({
        workGpuH: 3, remainingGpuH: 3, maxGpus: 3, window: { ...currentHour },
    }), map([slot("A", 0.01, { capGpus: 3, availablePowerKW: 0.3, availableEnergyKWh: 0.3 })]),
    options({ kWhPerGpuHour: 0.1 }));
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error(outcome.explanation);
    expect(outcome.allocation.allocatedGpus).toBe(3);
    expect(outcome.allocation.requiredPowerKW).toBeCloseTo(0.3, 15);
    expect(outcome.allocation.energy[0].estimatedKWh).toBeCloseTo(0.3, 15);
});

test("generated rounding retains the original operation order for large finite values", () => {
    expect(floorWholeUnits({ value: 1e308 })).toBe(1.0000000000000008e308);
    expect(exceeds({ value: 1e308, limit: 9e307 })).toBe(true);
});

test("a large energy shortfall is rejected without overflowing its comparison tolerance", async () => {
    const outcome = await chooseExecutionSlot(job({ window: { ...currentHour } }), map([
        slot("A", 0.01, { capGpus: 1, availablePowerKW: 1e308, availableEnergyKWh: 9e307 }),
    ]), options({ kWhPerGpuHour: 1e308 }));
    expect(outcome.selected).toBe(false);
});

test("a supplied version token is validated without rewriting it", async () => {
    const reading = slot("A", 0.09);
    reading.version = "  source:7  ";
    const outcome = await chooseExecutionSlot(job(), map([reading]), options());
    expect(outcome).toMatchObject({ selected: true, allocation: { slotVersion: "  source:7  " } });
});

test("an unusable snapshot is rejected before asking for a transfer or forecast", async () => {
    const reading = slot("B", 0);
    reading.status = "stale";
    const supplied = map([reading]);
    supplied.readForecast = () => { throw new Error("An unusable slot must not request a forecast."); };
    const outcome = await chooseExecutionSlot(job(), supplied, options({
        transferTo: () => { throw new Error("An unusable slot must not request a transfer."); },
    }));
    expect(outcome.selected).toBe(false);
});

test("disallowed locations are never read and a home allocation never requests a transfer", async () => {
    const supplied = map([slot("A", 0.09), slot("B", 0)]);
    const readSlot = supplied.readSlot;
    supplied.readSlot = (reference, asOf, maximumAgeMinutes) => {
        if (reference.locationId === "B") throw new Error("A disallowed location must not be read.");
        return readSlot(reference, asOf, maximumAgeMinutes);
    };
    const outcome = await chooseExecutionSlot(job({ allowedLocations: ["A"] }), supplied, options({
        transferTo: () => { throw new Error("A home allocation must not request a transfer."); },
    }));
    expect(outcome).toMatchObject({ selected: true, allocation: { slot: { locationId: "A" } } });
});

test("the first transfer rejection remains the explanation even when later transfers are possible", async () => {
    const outcome = await chooseExecutionSlot(job({ allowedLocations: ["B", "C"] }), map([
        slot("B", 0), slot("C", 0),
    ]), options({ transferTo: locationId => locationId === "B" ? undefined : { hours: 0.5, costUsd: 0 } }));
    expect(outcome.selected).toBe(false);
    expect(outcome.explanation).toBe("Transfer assumptions for B are unavailable.");
});

test("the transfer provider keeps its original options receiver", async () => {
    const routingOptions = options();
    routingOptions.transferTo = function (this: typeof routingOptions) {
        return { hours: 0, costUsd: this.kWhPerGpuHour * 0.01 };
    };
    const outcome = await chooseExecutionSlot(job(), map([slot("B", 0.06)]), routingOptions);
    expect(outcome).toMatchObject({ selected: true, allocation: { slot: { locationId: "B" } } });
});

test("the simulation shop hook can call the chooser through the versioned energy map", async () => {
    const outcomes: JobOutcome[] = [];
    const readings = [slot("A", 0.09), slot("B", 0.06)];
    const energy = createEnergyMap({
        window: job().window,
        sites: ["A", "B"].map(locationId => ({ locationId, regionId: "PACE", computeProfile: "gpu" })),
    }, {
        siteEnergy: { slots: locationId => readings.filter(reading => reading.slot?.locationId === locationId) },
        regionalGrid: { read: () => ({ observations: [], forecast: {} }) },
    });
    const simulation = createSimulation({
        seed: 1, snapshotId: "chooser-contract", startAt: now, hours: 1, syntheticForecast: false,
        workload: { kind: "fixture", jobs: [job()] },
    }, {
        energy,
        createPhases: () => ({
            shop: async context => {
                const router: Router = {
                    route: submitted => chooseExecutionSlot(submitted, context.energy, {
                        ...options(), asOf: context.asOf,
                    }),
                };
                for (const submitted of context.jobs) outcomes.push(await route(submitted, router));
            },
        }),
    });

    await simulation.step();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ selected: true, allocation: { slot: { locationId: "B" } } });
    expect(simulation.jobs()[0]).toMatchObject({ state: "queued", remainingGpuH: 1 });
    expect(readings.map(reading => reading.slot!.usedGpus)).toEqual([0, 0]);
});
