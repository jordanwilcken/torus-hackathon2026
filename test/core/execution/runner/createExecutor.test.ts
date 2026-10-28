import { describe, expect, it } from "vitest";
import { at, basis, executor, hour, job, selection, site } from "./fixture.js";

describe("simulation executor", () => {
    it("meters a quarter GPU-hour once, including the idle site's fixed load", () => {
        const submitted = job({ workGpuH: 0.25, remainingGpuH: 0.25, window: hour(0) });
        const active = site("A"), idle = site("B", { fixedLoadKW: 1 });
        const runner = executor([submitted], [active, idle]);
        const selected = selection(submitted, active, 0, { gpus: 1, estimatedKWh: 0.2125 });

        expect(runner.accept(selected)).toBe(true);
        runner.accept(selected);
        expect(runner.job(submitted.id)).toMatchObject({ remainingGpuH: 0.25 });

        const first = runner.tick(hour(0));
        expect(first.feasible).toBe(true);
        expect(first.executions).toEqual([expect.objectContaining({
            jobId: "batch", locationId: "A", completedGpuH: 0.25, remainingGpuH: 0,
            state: "done", computeKWh: 0.2125, postedChargeUsd: 0.25,
        })]);
        expect(first.meters.find(meter => meter.locationId === "A")).toMatchObject({
            computeKWh: 0.2125, gridImportKWh: 0.2125, electricityUsd: 0.010625,
        });
        expect(first.meters.find(meter => meter.locationId === "B")).toMatchObject({
            fixedLoadKWh: 1, computeKWh: 0, gridImportKWh: 1, electricityUsd: 0.05,
        });
        const settled = [active.ledger.state(), idle.ledger.state()];
        expect(runner.tick(hour(0))).toEqual(first);
        expect([active.ledger.state(), idle.ledger.state()]).toEqual(settled);
        expect(runner.job("batch")).toMatchObject({ remainingGpuH: 0, state: "done" });
    });

    it("captures constructor jobs and returns independent job snapshots", () => {
        const submitted = job(), active = site("A");
        const runner = executor([submitted], [active]);
        submitted.remainingGpuH = 99;
        submitted.allowedLocations.length = 0;
        const observed = runner.job("batch")!;
        expect(observed.remainingGpuH).toBe(2);
        expect(observed.allowedLocations).toEqual(["A", "B"]);
        observed.remainingGpuH = 88;
        observed.allowedLocations.length = 0;
        expect(runner.job("batch")).toMatchObject({ remainingGpuH: 2, allowedLocations: ["A", "B"] });
        expect(runner.job("unknown")).toBeUndefined();
    });

    it("cannot accept a future projected slot before its canonical hour", () => {
        const submitted = job(), active = site("A", { observedAt: at(0) });
        const runner = executor([submitted], [active]);
        const before = active.ledger.state();
        expect(runner.accept(selection(submitted, active, 1))).toBe(false);
        expect(active.ledger.state()).toEqual(before);
        expect(runner.job("batch")).toMatchObject({ remainingGpuH: 2, state: "queued" });
    });

    it("rejects an old observed quote despite current supply status", () => {
        const submitted = job(), active = site("A", { observedAt: at(-1) });
        const runner = executor([submitted], [active]);
        const before = active.ledger.state();
        expect(runner.accept(selection(submitted, active))).toBe(false);
        expect(active.ledger.state()).toEqual(before);
    });

    it("rejects a selection superseded by a new publication", () => {
        const submitted = job(), active = site("A");
        const runner = executor([submitted], [active]);
        const oldSelection = selection(submitted, active);
        active.ledger.refreshPublication();
        const before = active.ledger.state();
        expect(runner.accept(oldSelection)).toBe(false);
        expect(active.ledger.state()).toEqual(before);
    });

    it("requires the quoted posted rate and its basis", () => {
        const submitted = job(), active = site("A"), runner = executor([submitted], [active]);
        const wrongPrice = selection(submitted, active);
        wrongPrice.allocation.postedUsdPerGpuHour = 0.01;
        const wrongBasis = selection(submitted, active);
        wrongBasis.allocation.priceBasis = "A different accounting boundary";
        const before = active.ledger.state();
        expect(runner.accept(wrongPrice)).toBe(false);
        expect(runner.accept(wrongBasis)).toBe(false);
        expect(active.ledger.state()).toEqual(before);
    });

    it("does not accept a site with a different compute profile", () => {
        const submitted = job({ computeProfile: "unsupported" }), active = site("A");
        const runner = executor([submitted], [active]);
        const before = active.ledger.state();
        expect(runner.accept(selection(submitted, active))).toBe(false);
        expect(active.ledger.state()).toEqual(before);
    });

    it("rejects GPU or power quantities inconsistent with the selected job", () => {
        const submitted = job(), active = site("A"), runner = executor([submitted], [active]);
        const tooManyGpus = selection(submitted, active, 0, { gpus: 2, estimatedKWh: 1.7 });
        const wrongPower = selection(submitted, active);
        wrongPower.allocation.requiredPowerKW = 0.1;
        const wrongEnergyProfile = selection(submitted, active);
        wrongEnergyProfile.allocation.kWhPerGpuHour = 0.1;
        const before = active.ledger.state();
        expect(runner.accept(tooManyGpus)).toBe(false);
        expect(runner.accept(wrongPower)).toBe(false);
        expect(runner.accept(wrongEnergyProfile)).toBe(false);
        expect(active.ledger.state()).toEqual(before);
    });

    it("requires an explicit move before accepting a remote selection", () => {
        const submitted = job(), home = site("A"), destination = site("B");
        const runner = executor([submitted], [home, destination]);
        const before = [home.ledger.state(), destination.ledger.state()];
        expect(runner.accept(selection(submitted, destination))).toBe(false);
        expect(runner.job("batch")).toMatchObject({ currentLocation: "A", state: "queued" });
        expect([home.ledger.state(), destination.ledger.state()]).toEqual(before);
    });

    it("rejects skipped, partial and zero-duration tick windows without mutation", () => {
        const submitted = job(), active = site("A"), runner = executor([submitted], [active]);
        const before = active.ledger.state(), originalJob = runner.job("batch");
        expect(runner.tick(hour(1)).feasible).toBe(false);
        expect(runner.tick({ startAt: at(0), endAt: "2026-10-28T12:30:00Z" }).feasible).toBe(false);
        expect(runner.tick({ startAt: at(0), endAt: at(0) }).feasible).toBe(false);
        expect(active.ledger.state()).toEqual(before);
        expect(runner.job("batch")).toEqual(originalJob);
        expect(runner.tick(hour(0)).feasible).toBe(true);
    });

    it("runs only until a mid-hour deadline and marks unfinished work missed", () => {
        const deadline = "2026-10-28T12:30:00Z";
        const submitted = job({ workGpuH: 1, remainingGpuH: 1, window: { startAt: at(0), endAt: deadline } });
        const active = site("A"), runner = executor([submitted], [active]);
        const selected = selection(submitted, active, 0, { gpus: 1, estimatedKWh: 0.425,
            window: { startAt: at(0), endAt: deadline } });
        expect(runner.accept(selected)).toBe(true);
        const tick = runner.tick(hour(0));
        expect(tick.feasible).toBe(true);
        expect(tick.executions[0]).toMatchObject({ completedGpuH: 0.5, remainingGpuH: 0.5,
            state: "missed", computeKWh: 0.425, postedChargeUsd: 0.5 });
        expect(runner.job("batch")).toMatchObject({ remainingGpuH: 0.5, state: "missed" });
        expect(runner.tick(hour(1)).executions.every(execution => execution.completedGpuH === 0)).toBe(true);
    });

    it("pauses an accepted allocation when an outage removes its supply", () => {
        const submitted = job(), active = site("A"), runner = executor([submitted], [active]);
        expect(runner.accept(selection(submitted, active))).toBe(true);
        active.update(0, reading => { reading.supply!.gridImportLimitKW = 0; });
        const tick = runner.tick(hour(0));
        expect(tick.feasible).toBe(true);
        expect(tick.executions.every(execution => execution.completedGpuH === 0)).toBe(true);
        expect(tick.meters[0]).toMatchObject({ computeKWh: 0, gridImportKWh: 0 });
        expect(runner.job("batch")).toMatchObject({ state: "paused", remainingGpuH: 2 });
    });

    it("keeps a checkpoint through outage, transfer, arrival and a fresh-slot resume", () => {
        const submitted = job({ workGpuH: 1.25, remainingGpuH: 1.25 });
        const home = site("A"), destination = site("B", { rate: 2, observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        expect(runner.accept(selection(submitted, home))).toBe(true);
        expect(runner.tick(hour(0)).executions[0]).toMatchObject({ completedGpuH: 1, remainingGpuH: 0.25 });
        const checkpoint = runner.job("batch")!;
        expect(runner.accept(selection(checkpoint, home, 1, { gpus: 1, estimatedKWh: 0.2125 }))).toBe(true);
        home.update(1, reading => { reading.supply!.gridImportLimitKW = 0; });
        runner.tick(hour(1));
        expect(runner.job("batch")).toMatchObject({ state: "paused", remainingGpuH: 0.25 });
        // Publish known future evidence for the necessary transfer check, without reserving it.
        for (const index of [2, 3, 4, 5, 6]) destination.update(index, reading => { reading.evidence.observedAt = at(2); });
        const movingJob = runner.job("batch")!;
        const move = runner.move(movingJob, "B", at(2));
        expect(move.started).toBe(true);
        if (!move.started) throw new Error(move.explanation);
        expect(move.readyAt).toBe(at(3));
        expect(move.evidence).toMatchObject({ fromLocation: "A", toLocation: "B", energyKWh: 0.2,
            carbonKg: 0.08, electricityUsd: 0.01, jobChargeUsd: 0.3, accountingBasis: basis });
        expect(runner.move(movingJob, "B", at(2))).toEqual(move);
        expect(runner.job("batch")).toMatchObject({ state: "moving", transferToLocation: "B", currentLocation: "A", remainingGpuH: 0.25 });
        expect(runner.tick(hour(2)).executions.every(execution => execution.completedGpuH === 0)).toBe(true);
        expect(runner.job("batch")).toMatchObject({ state: "queued", currentLocation: "B", remainingGpuH: 0.25, readyAt: at(3) });
        const arrived = runner.job("batch")!;
        // A quote last observed at 14:00 cannot resume work at 15:00.
        expect(runner.accept(selection(arrived, destination, 3, { gpus: 1, estimatedKWh: 0.2125 }))).toBe(false);
        expect(runner.tick(hour(3)).executions.every(execution => execution.completedGpuH === 0)).toBe(true);
        destination.update(4, reading => { reading.evidence.observedAt = at(4); });
        expect(runner.accept(selection(runner.job("batch")!, destination, 4, { gpus: 1, estimatedKWh: 0.2125 }))).toBe(true);
        const final = runner.tick(hour(4));
        expect(final.executions.find(execution => execution.jobId === "batch")).toMatchObject({
            locationId: "B", completedGpuH: 0.25, remainingGpuH: 0, computeKWh: 0.2125, postedChargeUsd: 0.5, state: "done",
        });
        expect(runner.job("batch")).toMatchObject({ remainingGpuH: 0, state: "done" });
        expect(runner.move(movingJob, "B", at(2))).toEqual(move);
    });

    it("rejects a destination with no known capacity without changing the job", () => {
        const submitted = job({ state: "paused" }), home = site("A"), destination = site("B", { gridImportLimitKW: 0, observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        const before = runner.job("batch"), ledgers = [home.ledger.state(), destination.ledger.state()];
        expect(runner.move(before!, "B", at(0)).started).toBe(false);
        expect(runner.job("batch")).toEqual(before);
        expect([home.ledger.state(), destination.ledger.state()]).toEqual(ledgers);
    });

    it("rejects a forbidden destination rather than choosing a different one", () => {
        const submitted = job({ allowedLocations: ["A"] }), home = site("A"), destination = site("B", { observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        const before = runner.job("batch");
        expect(runner.move(before!, "B", at(0)).started).toBe(false);
        expect(runner.job("batch")).toEqual(before);
    });

    it("rejects a move whose rounded arrival leaves too little execution time", () => {
        const submitted = job({ window: { startAt: at(0), endAt: at(1) }, workGpuH: 0.25, remainingGpuH: 0.25 });
        const home = site("A"), destination = site("B", { observedAt: at(0) }), runner = executor([submitted], [home, destination]);
        const before = runner.job("batch");
        expect(runner.move(before!, "B", at(0)).started).toBe(false);
        expect(runner.job("batch")).toEqual(before);
    });

    it("retains unknown transfer carbon and electricity rather than inventing zeros", () => {
        const submitted = job({ state: "paused" }), home = site("A"), destination = site("B", { observedAt: at(0) });
        const runner = executor([submitted], [home, destination], () => ({ bandwidthGBPerHour: 20,
            kWhPerGB: 0.02, accountingBasis: basis, jobChargeUsdPerGB: 0.03 }));
        const move = runner.move(runner.job("batch")!, "B", at(0));
        expect(move.started).toBe(true);
        if (!move.started) throw new Error(move.explanation);
        expect(move.evidence.energyKWh).toBeCloseTo(0.2, 9);
        expect(move.evidence.carbonKg).toBeUndefined();
        expect(move.evidence.electricityUsd).toBeUndefined();
    });

    it("rejects invalid transfer assumptions without effects", () => {
        const submitted = job(), home = site("A"), destination = site("B", { observedAt: at(0) });
        const runner = executor([submitted], [home, destination], () => ({ bandwidthGBPerHour: 0,
            kWhPerGB: 0.02, accountingBasis: basis, jobChargeUsdPerGB: 0.03 }));
        const before = runner.job("batch"), ledgers = [home.ledger.state(), destination.ledger.state()];
        expect(runner.move(before!, "B", at(0)).started).toBe(false);
        expect(runner.job("batch")).toEqual(before);
        expect([home.ledger.state(), destination.ledger.state()]).toEqual(ledgers);
    });

    it("requires the supplied move job to match the authoritative checkpoint", () => {
        const submitted = job(), home = site("A"), destination = site("B", { observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        const changed = runner.job("batch")!;
        changed.remainingGpuH = 0.1;
        expect(runner.move(changed, "B", at(0)).started).toBe(false);
        expect(runner.job("batch")).toMatchObject({ remainingGpuH: 2, currentLocation: "A", state: "queued" });
    });

    it("can arrive immediately for a zero-data transfer but still needs a new slot", () => {
        const submitted = job({ dataGB: 0 }), home = site("A"), destination = site("B", { observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        const move = runner.move(runner.job("batch")!, "B", at(0));
        expect(move.started).toBe(true);
        if (!move.started) throw new Error(move.explanation);
        expect(move.readyAt).toBe(at(0));
        expect(move.evidence).toMatchObject({ energyKWh: 0, jobChargeUsd: 0 });
        expect(runner.job("batch")).toMatchObject({ currentLocation: "B", state: "queued", remainingGpuH: 2 });
        expect(runner.tick(hour(0)).executions.every(execution => execution.completedGpuH === 0)).toBe(true);
    });

    it("stops future fleet ticks after an infeasible idle site without claiming rollback", () => {
        const submitted = job(), home = site("A"), impossibleIdle = site("B", { fixedLoadKW: 1, gridImportLimitKW: 0 });
        const runner = executor([submitted], [home, impossibleIdle]);
        const first = runner.tick(hour(0));
        expect(first.feasible).toBe(false);
        const afterFailure = [home.ledger.state(), impossibleIdle.ledger.state()];
        expect(runner.tick(hour(1)).feasible).toBe(false);
        expect([home.ledger.state(), impossibleIdle.ledger.state()]).toEqual(afterFailure);
        expect(runner.tick(hour(0))).toEqual(first);
    });
});
