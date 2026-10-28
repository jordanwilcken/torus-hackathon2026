import { expect, test } from "vitest";
import { createPairedReplaySession } from "../../../../src/core/execution/replay/createPairedReplaySession.js";
import { runPairedReplay } from "../../../../src/core/execution/replay/runPairedReplay.js";
import { threeHourScenario } from "./fixture.js";
import type { ReplayScenario } from "../../../../src/core/execution/replay/Replay.types.js";

/** Three hourly ticks: A is grid-powered; B has 1 kW solar and a matching single GPU. */
function fleetScenario(): ReplayScenario {
    const scenario = threeHourScenario();
    scenario.routing = { policy: "fleet", transfer: {
        bandwidthGBPerHour: 2, kWhPerGB: 0.01, jobChargeUsdPerGB: 0.001,
        carbonGPerKWh: 400, electricityUsdPerMWh: 50,
        accountingBasis: scenario.sites[0].configuration.accountingBasis,
    } };
    scenario.jobs[0].allowedLocations = ["A", "B"];
    scenario.jobs[0].dataGB = 1;
    for (const site of scenario.sites) {
        site.configuration.compute = { capGpus: 1, kWPerGpu: 1 };
        for (const input of [...site.forecast, ...site.observations]) {
            input.supply!.fixedLoadKW = 0;
            input.supply!.solarKW = site.configuration.locationId === "B" ? 1 : 0;
        }
    }
    return scenario;
}

test("fleet routing moves to allowed solar, waits through rounded transfer latency, and records one modeled charge", async () => {
    const session = createPairedReplaySession(fleetScenario());
    await session.step(progress => {
        expect(progress.selected.finalJobs[0]).toMatchObject({ state: "moving", currentLocation: "A", transferToLocation: "B", remainingGpuH: 1 });
        expect(progress.selected.run.ticks).toHaveLength(0);
        expect(progress.selected.decisions[0].results[0]).toMatchObject({
            accepted: false,
            selection: { selected: false, transfer: { destination: "B", readyAt: "2026-10-28T19:00:00.000Z" } },
            transfer: { started: true },
        });
    });
    const arrived = session.read();
    expect(arrived.selected.run.transfers).toHaveLength(1);
    expect(arrived.selected.run.transfers[0]).toMatchObject({
        fromLocation: "A", toLocation: "B", energyKWh: 0.01, jobChargeUsd: 0.001,
        carbonKg: 0.004, electricityUsd: 0.0005,
        window: { startAt: "2026-10-28T18:00:00Z", endAt: "2026-10-28T19:00:00.000Z" },
    });
    expect(arrived.selected.run.ticks[0].executions[0].completedGpuH).toBe(0);
    expect(arrived.selected.finalJobs[0]).toMatchObject({ state: "queued", currentLocation: "B", remainingGpuH: 1 });
    await session.step();
    expect(session.read().selected.run.ticks[1].executions[0]).toMatchObject({ locationId: "B", completedGpuH: 1, state: "done" });
    await session.step();
    const result = session.result();
    expect(result.selected.policy).toBe("fleet-edf-priced-transfer-v1");
    expect(result.selected.run.simulated).toBe(true);
    expect(result.selected.run.transfers).toHaveLength(1);
    expect(result.selected.impact.modeledCostUsd).toBeCloseTo(0.0019);
    expect(result.baseline.run.transfers).toEqual([]);
    expect(result.baseline.finalJobs[0]).toMatchObject({ currentLocation: "A", state: "done" });
    expect(result.comparison.comparison).toBe("comparable");
    expect((await session.step()).selected.run.transfers).toEqual(result.selected.run.transfers);
    expect(await runPairedReplay(result.scenario)).toEqual(result);
});

test("a one-and-a-half-hour transfer completes no work until the second hourly boundary", async () => {
    const scenario = fleetScenario();
    scenario.jobs[0].dataGB = 3;
    const result = await runPairedReplay(scenario);
    expect(result.selected.run.transfers[0]?.window.endAt).toBe("2026-10-28T20:00:00.000Z");
    expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([0, 0, 1]);
    expect(result.selected.finalJobs[0].state).toBe("done");
});

test("waiting for cheaper home solar avoids an unnecessary transfer", async () => {
    const scenario = fleetScenario();
    for (const inputs of [scenario.sites[0].forecast, scenario.sites[0].observations]) {
        inputs[1].supply!.solarKW = 1;
        inputs[2].supply!.solarKW = 1;
    }
    const result = await runPairedReplay(scenario);
    expect(result.selected.decisions[0].results[0].selection.explanation).toContain("Waiting");
    expect(result.selected.run.transfers).toEqual([]);
    expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([0, 1, 0]);
    expect(result.selected.finalJobs[0].currentLocation).toBe("A");
});

test("allowed locations, transfer cost and deadline each prevent an unjustified move", async () => {
    const restricted = fleetScenario();
    restricted.jobs[0].allowedLocations = ["A"];
    const expensive = fleetScenario();
    Object.assign(expensive, { routing: { policy: "fleet", transfer: {
        bandwidthGBPerHour: 2, kWhPerGB: 0.01, jobChargeUsdPerGB: 1,
        carbonGPerKWh: 400, electricityUsdPerMWh: 50,
        accountingBasis: expensive.sites[0].configuration.accountingBasis,
    } } });
    const urgent = fleetScenario();
    urgent.jobs[0].window.endAt = "2026-10-28T19:00:00Z";
    for (const scenario of [restricted, expensive, urgent]) {
        const result = await runPairedReplay(scenario);
        expect(result.selected.run.transfers).toEqual([]);
        expect(result.selected.finalJobs[0]).toMatchObject({ currentLocation: "A", state: "done" });
    }
});

test("a destination solar drop changes the actual modeled settlement after transfer", async () => {
    const session = createPairedReplaySession(fleetScenario());
    await session.step();
    session.schedule({ atHour: 1, kind: "solar-drop", payload: { locationId: "B" } });
    await session.step();
    await session.step();
    const result = session.result();
    expect(result.selected.run.transfers).toHaveLength(1);
    expect(result.selected.run.ticks[1].meters.find(meter => meter.locationId === "B")?.gridImportKWh).toBe(1);
    expect(result.selected.run.ticks[1].executions[0]).toMatchObject({ locationId: "B", completedGpuH: 1 });
    expect(result.reductions.carbonKg).toBeCloseTo(-0.004);
    expect(result).toEqual(await runPairedReplay(result.scenario));
});

test("fleet mode rejects missing or zero-priced transfer assumptions instead of silently moving for free", () => {
    for (const invalid of [{ bandwidthGBPerHour: 0 }, { kWhPerGB: 0 }, { jobChargeUsdPerGB: 0 }, { accountingBasis: "other" }]) {
        const scenario = fleetScenario();
        const routing = scenario.routing!;
        Object.assign(routing.transfer, invalid);
        expect(() => createPairedReplaySession(scenario)).toThrow(/transfer/i);
    }
});

test("declared site geography is published without changing its shared grid identity", () => {
    const scenario = fleetScenario();
    Object.assign(scenario.sites[0], { name: "Salt Lake", lat: 40.7608, lng: -111.891, regionId: "PACE" });
    Object.assign(scenario.sites[1], { name: "Cedar City", lat: 37.6775, lng: -113.0619, regionId: "PACE" });
    const progress = createPairedReplaySession(scenario).read();
    expect(progress.map.sites.get("A")).toMatchObject({ name: "Salt Lake", latitude: 40.7608, longitude: -111.891, regionId: "PACE" });
    expect(progress.map.sites.get("B")).toMatchObject({ name: "Cedar City", latitude: 37.6775, longitude: -113.0619, regionId: "PACE" });
});


test("unknown transfer accounting cannot be treated as zero cost", async () => {
    const scenario = fleetScenario();
    delete scenario.routing!.transfer.carbonGPerKWh;
    delete scenario.routing!.transfer.electricityUsdPerMWh;
    const result = await runPairedReplay(scenario);
    expect(result.selected.run.transfers).toEqual([]);
    expect(result.selected.finalJobs[0]).toMatchObject({ currentLocation: "A", state: "done" });
});

test("a partly completed job migrates with its authoritative remaining work, then resumes once", async () => {
    const scenario = fleetScenario();
    scenario.jobs[0].workGpuH = scenario.jobs[0].remainingGpuH = 2;
    scenario.sites[0].forecast[0].supply!.solarKW = 1;
    scenario.sites[0].observations[0].supply!.solarKW = 1;
    const result = await runPairedReplay(scenario);
    expect(result.selected.run.transfers).toHaveLength(1);
    expect(result.selected.run.transfers[0].window).toEqual({ startAt: "2026-10-28T19:00:00Z", endAt: "2026-10-28T20:00:00.000Z" });
    expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([1, 0, 1]);
    expect(result.selected.run.ticks.map(tick => tick.executions[0].remainingGpuH)).toEqual([1, 1, 0]);
    expect(result.selected.finalJobs[0]).toMatchObject({ currentLocation: "B", state: "done", remainingGpuH: 0 });
    expect(result.selected.impact.work[0].completedGpuH).toBe(2);
});

test("arrival needs a fresh usable destination slot instead of executing against the earlier forecast", async () => {
    const scenario = fleetScenario();
    scenario.sites[1].observations[1].supply!.solarKW = 0;
    scenario.sites[1].observations[1].supply!.gridImportLimitKW = 0;
    const result = await runPairedReplay(scenario);
    expect(result.selected.run.transfers).toHaveLength(1);
    expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([0, 0, 1]);
    expect(result.selected.decisions[1].results[0].accepted).toBe(false);
    expect(result.selected.finalJobs[0]).toMatchObject({ currentLocation: "B", state: "done" });
});
