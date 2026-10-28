import { expect, test } from "vitest";
import { runPairedReplay } from "../../../../src/core/execution/replay/runPairedReplay.js";
import { threeHourScenario } from "./fixture.js";
import { runReplayArm } from "../../../../src/core/execution/replay/runReplayArm.js";
import storageInputs from "../../../../examples/replay/storage-shift.json";
import type { ReplayScenario } from "../../../../src/core/execution/replay/Replay.types.js";

test("the same 1 GPU-hour job waits for solar instead of immediate grid execution, with idle energy counted in both arms", async () => {
    // Three hours, grid then two forecast/real solar hours at A; idle B consumes 0.1 kW throughout.
    const result = await runPairedReplay(threeHourScenario());

    expect(result.comparison.comparison).toBe("comparable");
    expect(result.reductions.carbonKg).toBeCloseTo(0.4);
    expect(result.reductions.modeledCostUsd).toBeCloseTo(0.09);
    expect(result.baseline.impact.carbonKg).toBeCloseTo(0.52, 12);
    expect(result.baseline.impact.electricityUsd).toBeCloseTo(0.065, 12);
    expect(result.selected.impact.carbonKg).toBeCloseTo(0.12);
    expect(result.selected.impact.electricityUsd).toBeCloseTo(0.015);
    expect(result.baseline.impact.work).toEqual([{ jobId: "training", requiredGpuH: 1, completedGpuH: 1 }]);
    expect(result.selected.impact.work).toEqual(result.baseline.impact.work);
    expect(result.baseline.impact.execution?.jobs[0].startDelayHours).toBe(0);
    expect(result.selected.impact.execution?.jobs[0].startDelayHours).toBe(1);
    expect(result.selected.decisions[0].results[0].selection.explanation).toContain("Waiting");
    expect(result.baseline.run.ticks.flatMap(tick => tick.meters)).toHaveLength(6);
    expect(result.selected.run.ticks.flatMap(tick => tick.meters)).toHaveLength(6);
    expect(result.baseline.impact.inventory).toEqual(result.selected.impact.inventory);
    expect(result.baseline.impact.inventory.every(site => site.endingStoredKWh === 0)).toBe(true);
});

test("the same storage charges and discharges in both arms, with equal ending inventory", async () => {
    // Four hours: A solar 0,2,1,0 kW; 1 kWh battery; 1 kW fixed load in the final hour.
    const result = await runPairedReplay(structuredClone(storageInputs) as ReplayScenario);

    expect(result.comparison.comparison).toBe("comparable");
    expect(result.reductions.carbonKg).toBeCloseTo(0.4, 12);
    expect(result.reductions.modeledCostUsd).toBeCloseTo(0.09, 12);
    for (const arm of [result.baseline, result.selected]) {
        const site = arm.impact.execution?.sites.find(site => site.locationId === "A");
        expect(site?.batteryChargeKWh).toBe(1);
        expect(site?.batteryDischargeKWh).toBe(1);
        expect(arm.impact.inventory.find(site => site.locationId === "A")).toEqual({
            locationId: "A", initialStoredKWh: 0, endingStoredKWh: 0,
        });
    }
});

test("retaining extra stored energy invalidates a savings comparison even when both jobs finish", async () => {
    const scenario = threeHourScenario();
    scenario.sites[0].configuration.storage = {
        initial: { storedKWh: 1, carbonKg: 0.4, electricityUsd: 0.05 },
        limits: { capacityKWh: 1, chargeKW: 0, dischargeKW: 1 },
        efficiency: { charge: 1, discharge: 1 },
    };
    const result = await runPairedReplay(scenario);

    expect(result.baseline.finalJobs[0].state).toBe("done");
    expect(result.selected.finalJobs[0].state).toBe("done");
    expect(result.baseline.impact.inventory[0].endingStoredKWh).toBe(0);
    expect(result.selected.impact.inventory[0].endingStoredKWh).toBe(1);
    expect(result.comparison.comparison).toBe("not-comparable");
    expect(result.comparison.carbon.unavailableReason).toMatch(/stor/i);
    expect(result.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
});

test("arm execution order cannot change either result", async () => {
    const scenario = threeHourScenario();
    const selectedFirst = await runReplayArm(scenario, "selected");
    const baselineSecond = await runReplayArm(scenario, "baseline");
    const paired = await runPairedReplay(scenario);

    expect(selectedFirst).toEqual(paired.selected);
    expect(baselineSecond).toEqual(paired.baseline);
});

test("baseline serves equal-arrival jobs FIFO while coordination serves the earlier deadline first", async () => {
    const scenario = threeHourScenario();
    scenario.sites[0].forecast.forEach(input => { input.supply!.solarKW = 0; });
    scenario.sites[0].observations.forEach(input => { input.supply!.solarKW = 0; });
    const laterDeadline = { ...scenario.jobs[0], id: "a-later" };
    const urgent = { ...structuredClone(scenario.jobs[0]), id: "z-urgent",
        window: { ...scenario.jobs[0].window, endAt: "2026-10-28T19:00:00Z" } };
    scenario.jobs = [urgent, laterDeadline];
    const result = await runPairedReplay(scenario);

    expect(result.baseline.decisions[0].results.map(result => [result.jobId, result.accepted]))
        .toEqual([["a-later", true], ["z-urgent", false]]);
    expect(result.selected.decisions[0].results.map(result => [result.jobId, result.accepted]))
        .toEqual([["z-urgent", true], ["a-later", false]]);
    expect(result.baseline.finalJobs.find(job => job.id === "z-urgent")?.state).toBe("missed");
    expect(result.selected.finalJobs.every(job => job.state === "done")).toBe(true);
    expect(result.comparison.comparison).toBe("not-comparable");
});

test("a late realized reading does not become visible early and a stopped run keeps only its actual receipts", async () => {
    const scenario = threeHourScenario();
    scenario.sites[0].observations[1].evidence.observedAt = "2026-10-28T20:00:00Z";
    const result = await runPairedReplay(scenario);

    expect(result.selected.run.ticks).toHaveLength(2);
    expect(result.selected.run.ticks[1].feasible).toBe(false);
    expect(result.selected.run.ticks[1].meters.map(meter => meter.locationId)).toEqual(["B"]);
    expect(result.selected.impact.execution?.complete).toBe(false);
    expect(result.comparison.comparison).toBe("not-comparable");
    expect(result.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
});

test("unknown actual carbon stays unknown instead of becoming zero savings", async () => {
    const scenario = threeHourScenario();
    delete scenario.sites[1].observations[0].accounting.gridCarbonGPerKWh;
    const result = await runPairedReplay(scenario);

    expect(result.baseline.impact.carbonKg).toBeNull();
    expect(result.selected.impact.carbonKg).toBeNull();
    expect(result.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
    expect(result.comparison.carbon.unavailableReason).toContain("unavailable");
});

test("capturing before the first await prevents caller edits from changing the second arm", async () => {
    const scenario = threeHourScenario();
    const pending = runPairedReplay(scenario);
    scenario.sites[0].observations[1].supply!.solarKW = 0;
    scenario.jobs[0].remainingGpuH = 999;
    const result = await pending;

    expect(result.comparison.comparison).toBe("comparable");
    expect(result.selected.finalJobs[0].state).toBe("done");
    expect(result.scenario.jobs[0].remainingGpuH).toBe(1);
    expect(result.scenario.sites[0].observations[1].supply?.solarKW).toBe(1);
});

test("unsupported migration is rejected explicitly rather than silently resetting the job home", async () => {
    const scenario = threeHourScenario();
    scenario.jobs[0].currentLocation = "B";
    await expect(runPairedReplay(scenario)).rejects.toThrow("migration is unsupported");
});

test("a forecast issued after replay start cannot influence the earlier decision", async () => {
    const scenario = threeHourScenario();
    scenario.sites[0].forecast[2].evidence.observedAt = "2026-10-28T19:00:00Z";
    await expect(runPairedReplay(scenario)).rejects.toThrow("issued by the scenario start");
});

test("hourly admission rejects a mid-hour job instead of silently reporting a missed feasible job", async () => {
    const scenario = threeHourScenario();
    scenario.jobs[0].readyAt = "2026-10-28T18:30:00Z";
    scenario.jobs[0].window.endAt = "2026-10-28T19:00:00Z";
    scenario.jobs[0].workGpuH = 0.25;
    scenario.jobs[0].remainingGpuH = 0.25;
    await expect(runPairedReplay(scenario)).rejects.toThrow("hour-aligned admission");
});

test("readiness after the replay horizon is rejected rather than exporting a job that never arrived", async () => {
    const scenario = threeHourScenario();
    scenario.jobs[0].readyAt = "2026-10-29T18:00:00Z";
    const reason = await runPairedReplay(scenario).then(() => undefined, error => error.message);
    expect(reason).toBe("Jobs must be ready within the declared replay horizon and have windows contained by it.");
});

test("a failed solar forecast preserves worse carbon and cost results from actual modeled execution", async () => {
    const scenario = threeHourScenario();
    const unexpectedGrid = scenario.sites[0].observations[1];
    unexpectedGrid.supply!.solarKW = 0;
    unexpectedGrid.accounting.gridCarbonGPerKWh = 600;
    unexpectedGrid.accounting.gridUsdPerMWh = 100;

    const result = await runPairedReplay(scenario);

    expect(result.comparison.comparison).toBe("comparable");
    expect(result.reductions.carbonKg).toBeCloseTo(-0.2);
    expect(result.reductions.modeledCostUsd).toBeCloseTo(-0.07);
    expect(result.selected.impact.carbonKg).toBeCloseTo(0.72);
    expect(result.selected.run.ticks[1].meters.find(site => site.locationId === "A")?.gridImportKWh).toBe(1);
    expect(result.scenario.sites[0].forecast[1].supply?.solarKW).toBe(1);
    expect(result.scenario.sites[0].forecast[1].evidence.projected).toBe(true);
});

test("uncompleted work does not earn savings", async () => {
    const scenario = threeHourScenario();
    scenario.jobs[0].workGpuH = 4;
    scenario.jobs[0].remainingGpuH = 4;

    const result = await runPairedReplay(scenario);

    expect(result.comparison.comparison).toBe("not-comparable");
    expect(result.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
    expect(result.baseline.finalJobs[0].state).toBe("missed");
    expect(result.selected.finalJobs[0].state).toBe("missed");
});

test("repeating a captured scenario produces identical evidence without changing the caller's inputs", async () => {
    const scenario = threeHourScenario();
    const before = structuredClone(scenario);
    const first = await runPairedReplay(scenario);
    const second = await runPairedReplay(scenario);

    expect(first.comparison.comparison).toBe("comparable");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(scenario).toEqual(before);
    expect(first.baseline.run.jobs[0].remainingGpuH).toBe(1);
    expect(first.baseline.finalJobs[0].remainingGpuH).toBe(0);
    first.baseline.run.ticks[0].meters[0].gridImportKWh = 999;
    expect(first.selected.run.ticks[0].meters[0].gridImportKWh).not.toBe(999);
    expect(second.baseline.run.ticks[0].meters[0].gridImportKWh).toBe(1);
});
