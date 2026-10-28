import { expect, test } from "vitest";
import { createPairedReplaySession } from "../../../../src/core/execution/replay/createPairedReplaySession.js";
import { runPairedReplay } from "../../../../src/core/execution/replay/runPairedReplay.js";
import { threeHourScenario } from "./fixture.js";
import streamInputs from "../../../../examples/replay/job-stream.json";
import storageInputs from "../../../../examples/replay/storage-shift.json";
import type { ReplayScenario } from "../../../../src/core/execution/replay/Replay.types.js";

test("stepping executes only the current hour and completes the same comparison as the command", async () => {
    const scenario = threeHourScenario();
    const session = createPairedReplaySession(scenario);
    expect(session.read().selected.run.ticks).toHaveLength(0);
    expect(() => session.result()).toThrow("Complete the replay");
    const first = await session.step();
    expect(first.hour).toBe(1);
    expect(first.done).toBe(false);
    expect(first.baseline.finalJobs[0].state).toBe("done");
    expect(first.selected.finalJobs[0].state).toBe("queued");
    expect(first.selected.decisions[0].results[0].selection.explanation).toContain("Waiting");
    expect(first.selected.run.ticks).toHaveLength(1);
    const second = await session.step();
    expect(second.selected.finalJobs[0].state).toBe("done");
    expect(second.selected.run.ticks).toHaveLength(2);
    await session.step();
    expect(session.read().done).toBe(true);
    expect(session.result()).toEqual(await runPairedReplay(scenario));
});

test("the routed notification observes accepted work before its execution receipt exists", async () => {
    const session = createPairedReplaySession(threeHourScenario());
    await session.step();
    let observed = false;
    await session.step(progress => {
        observed = true;
        expect(progress.phase).toBe("routed");
        expect(progress.selected.finalJobs[0].state).toBe("running");
        expect(progress.selected.run.ticks).toHaveLength(1);
        expect(progress.map.asOf).toBe("2026-10-28T19:00:00Z");
    });
    expect(observed).toBe(true);
    expect(session.read().selected.finalJobs[0].state).toBe("done");
});

test("a queued solar-drop event changes real execution in both arms and is reproducible from the export", async () => {
    const session = createPairedReplaySession(threeHourScenario());
    await session.step();
    session.schedule({ atHour: 1, kind: "solar-drop", payload: { locationId: "A" } });
    await session.step();
    await session.step();
    const result = session.result();
    expect(result.selected.run.ticks[1].meters.find(meter => meter.locationId === "A")?.gridImportKWh).toBe(1);
    expect(result.selected.log.some(entry => entry.type === "input" && entry.event.kind === "solar-drop")).toBe(true);
    expect(result.baseline.log.some(entry => entry.type === "input" && entry.event.kind === "solar-drop")).toBe(true);
    expect(result.reductions.carbonKg).toBeCloseTo(0, 12);
    expect(result).toEqual(await runPairedReplay(result.scenario));
});

test("successive arrivals reserve capacity and complete from receipts while future jobs stay upcoming", async () => {
    const session = createPairedReplaySession(structuredClone(streamInputs) as ReplayScenario);
    const first = await session.step();
    expect(first.selected.log.filter(entry => entry.type === "arrival").map(entry => entry.jobId)).toEqual(["job-01"]);
    expect(first.selected.finalJobs.map(job => job.state)).toEqual(["queued", "queued", "queued"]);
    const second = await session.step();
    expect(second.selected.finalJobs.map(job => job.state)).toEqual(["done", "queued", "queued"]);
    expect(second.selected.decisions[1].results.map(result => [result.jobId, result.accepted]))
        .toEqual([["job-01", true], ["job-02", false]]);
    const third = await session.step();
    expect(third.selected.finalJobs.map(job => job.state)).toEqual(["done", "done", "done"]);
    expect(third.done).toBe(false); // Include the final idle/storage tick before claiming a fair comparison.
    await session.step();
    expect(session.result().comparison.comparison).toBe("comparable");
    expect(session.result().selected.impact.work).toEqual([
        { jobId: "job-01", requiredGpuH: 1, completedGpuH: 1 },
        { jobId: "job-02", requiredGpuH: 1, completedGpuH: 1 },
        { jobId: "job-03", requiredGpuH: 1, completedGpuH: 1 },
    ]);
    expect(session.read().map.sites.size).toBe(2);
    expect(session.read().map.asOf).toBe("2026-10-28T21:00:00Z");
});

test("concurrent steps and events cannot change a step that is already executing", async () => {
    const session = createPairedReplaySession(threeHourScenario());
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let routed!: () => void;
    const reached = new Promise<void>(resolve => { routed = resolve; });
    const pending = session.step(async () => { routed(); await hold; });
    await reached;
    await expect(session.step()).rejects.toThrow("already running");
    expect(() => session.schedule({ atHour: 1, kind: "solar-drop", payload: { locationId: "A" } }))
        .toThrow("between active replay steps");
    release();
    await pending;
    expect(session.read().hour).toBe(1);
    expect(session.read().selected.run.ticks).toHaveLength(1);
});

test("a failed observer stops the session and reset-by-reconstruction has no accepted work or events", async () => {
    const scenario = threeHourScenario();
    const session = createPairedReplaySession(scenario);
    await expect(session.step(() => { throw new Error("View failed"); })).rejects.toThrow("View failed");
    await expect(session.step()).rejects.toThrow("construct a fresh session");
    expect(() => session.result()).toThrow("Complete the replay");
    const reset = createPairedReplaySession(scenario);
    expect(reset.read().hour).toBe(0);
    expect(reset.read().selected.run.ticks).toHaveLength(0);
    expect(reset.read().selected.decisions).toHaveLength(0);
    expect(reset.read().scenario.events).toBeUndefined();
});

test("invalid or past events leave both arms unchanged", async () => {
    const session = createPairedReplaySession(threeHourScenario());
    await session.step();
    const before = session.read();
    expect(() => session.schedule({ atHour: 0, kind: "solar-drop", payload: { locationId: "A" } }))
        .toThrow("unsettled hour");
    expect(() => session.schedule({ atHour: 1, kind: "invented", payload: { locationId: "A" } }))
        .toThrow("solar-drop event");
    expect(session.read()).toEqual(before);
});

test("snapshots are detached and stepping after completion does not duplicate receipts", async () => {
    const session = createPairedReplaySession(threeHourScenario());
    const first = await session.step();
    first.selected.run.ticks[0].meters.length = 0;
    first.scenario.jobs[0].workGpuH = 999;
    first.map.sites.clear();
    expect(session.read().selected.run.ticks).toHaveLength(1);
    expect(session.read().selected.run.ticks[0].meters).toHaveLength(2);
    expect(session.read().scenario.jobs[0].workGpuH).toBe(1);
    expect(session.read().map.sites.size).toBe(2);
    await session.step();
    await session.step();
    const complete = session.result();
    await session.step();
    expect(session.result()).toEqual(complete);
});

test("an infeasible arm retains its receipts while the healthy arm completes the reproducible comparison", async () => {
    const scenario = threeHourScenario();
    const site = scenario.sites[0];
    site.configuration.storage = {
        initial: { storedKWh: 1, carbonKg: 0.4, electricityUsd: 0.05 },
        limits: { capacityKWh: 1, chargeKW: 0, dischargeKW: 1 },
        efficiency: { charge: 1, discharge: 1 },
    };
    for (const input of [...site.forecast, ...site.observations]) input.supply!.gridImportLimitKW = 0;
    // FIFO spent its battery on work. The waiting arm can still serve this unforecast fixed load.
    site.observations[1].supply!.solarKW = 0;
    site.observations[1].supply!.fixedLoadKW = 1;
    const session = createPairedReplaySession(scenario);
    while (!session.read().done) await session.step();
    const stepped = session.result();

    expect(stepped.baseline.run.ticks.map(tick => tick.feasible)).toEqual([true, false]);
    expect(stepped.selected.run.ticks.map(tick => tick.feasible)).toEqual([true, true, true]);
    expect(stepped.selected.finalJobs[0]).toMatchObject({ state: "done", remainingGpuH: 0 });
    expect(stepped.comparison.comparison).toBe("not-comparable");
    expect(stepped.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
    expect(stepped).toEqual(await runPairedReplay(stepped.scenario));
});

test("an event after selected-arm failure affects only the continuing baseline and remains reproducible", async () => {
    const scenario = structuredClone(storageInputs) as ReplayScenario;
    const site = scenario.sites[0];
    // Baseline finishes on initial grid. At hour 1 it stores solar that selected spends on work.
    site.observations[1].supply!.solarKW = 1;
    site.observations[2].supply = { solarKW: 0, fixedLoadKW: 1, gridImportLimitKW: 0, protectedKWh: 0 };
    site.observations[3].supply!.solarKW = 1;
    const session = createPairedReplaySession(scenario);
    await session.step();
    await session.step();
    const failed = await session.step();

    expect(failed.hour).toBe(3);
    expect(failed.done).toBe(false);
    expect(failed.armDone).toEqual({ baseline: false, selected: true });
    expect(failed.selected.run.ticks.map(tick => tick.feasible)).toEqual([true, true, false]);
    expect(failed.baseline.run.ticks.map(tick => tick.feasible)).toEqual([true, true, true]);
    expect(() => session.result()).toThrow("Complete the replay");

    session.schedule({ atHour: 3, kind: "solar-drop", payload: { locationId: "A" } });
    const finished = await session.step();
    expect(finished.done).toBe(true);
    expect(finished.hour).toBe(4);
    expect(finished.armHours).toEqual({ baseline: 4, selected: 3 });
    expect(finished.selected).toEqual(failed.selected);
    expect(finished.baseline.run.ticks[3].meters.find(meter => meter.locationId === "A")?.gridImportKWh).toBe(1);
    expect(finished.baseline.log.some(entry => entry.type === "input" && entry.hour === 3)).toBe(true);
    expect(finished.selected.log.some(entry => entry.type === "input" && entry.hour === 3)).toBe(false);
    expect(session.result()).toEqual(await runPairedReplay(session.result().scenario));
});
