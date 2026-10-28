import { describe, expect, it } from "vitest";
import { at, executor, hour, job, selection, site } from "./fixture.js";

describe("executor reservation lifecycle", () => {
    it("cannot spend the same current GPU and stored energy twice", () => {
        const first = job({ id: "first", workGpuH: 1, remainingGpuH: 1 });
        const second = job({ id: "second", workGpuH: 1, remainingGpuH: 1 });
        const home = site("A", { capGpus: 1, storedKWh: 0.85, gridImportLimitKW: 0 });
        const runner = executor([first, second], [home]);
        const offeredFirst = selection(first, home), competing = selection(second, home);
        expect(runner.accept(offeredFirst)).toBe(true);
        expect(runner.accept(competing)).toBe(false);
        const reserved = home.ledger.state();
        expect(runner.accept(offeredFirst)).toBe(true);
        expect(home.ledger.state()).toEqual(reserved);
        const changed = structuredClone(offeredFirst);
        changed.allocation.postedUsdPerGpuHour = 0;
        expect(runner.accept(changed)).toBe(false);
        const actual = runner.tick(hour(0));
        expect(actual.executions.find(e => e.jobId === "first")).toMatchObject({ completedGpuH: 1, remainingGpuH: 0 });
        expect(actual.executions.find(e => e.jobId === "second")).toMatchObject({ completedGpuH: 0, remainingGpuH: 1 });
        expect(home.ledger.state().inventory.storedKWh).toBeCloseTo(0, 12);
        const settled = home.ledger.state();
        expect(runner.accept(offeredFirst)).toBe(true);
        expect(home.ledger.state()).toEqual(settled);
    });

    it("releases the old reservation when a valid move starts without reserving the destination", () => {
        const submitted = job(), home = site("A", { capGpus: 1 }), destination = site("B", { observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        expect(runner.accept(selection(submitted, home))).toBe(true);
        expect(home.ledger.slots("A", hour(0))[0].slot?.usedGpus).toBe(1);
        const beforeDestination = destination.ledger.state();
        const transfer = runner.move(runner.job("batch")!, "B", at(0));
        expect(transfer.started).toBe(true);
        expect(home.ledger.slots("A", hour(0))[0].slot?.usedGpus).toBe(0);
        expect(destination.ledger.state()).toEqual(beforeDestination);
        expect(runner.tick(hour(0)).executions[0].completedGpuH).toBe(0);
    });

    it("preserves an accepted source reservation when a move is rejected", () => {
        const submitted = job(), home = site("A"), destination = site("B", { gridImportLimitKW: 0, observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        expect(runner.accept(selection(submitted, home))).toBe(true);
        const before = home.ledger.state();
        expect(runner.move(runner.job("batch")!, "B", at(0)).started).toBe(false);
        expect(home.ledger.state()).toEqual(before);
        expect(runner.tick(hour(0)).executions[0].completedGpuH).toBe(1);
    });

    it("does no work before readiness within the current tick", () => {
        const ready = "2026-10-28T12:45:00.000Z";
        const submitted = job({ readyAt: ready, workGpuH: 0.5, remainingGpuH: 0.5 });
        const home = site("A"), runner = executor([submitted], [home]);
        expect(runner.accept(selection(submitted, home, 0, { gpus: 1, estimatedKWh: 0.2125,
            window: { startAt: ready, endAt: at(1) } }))).toBe(true);
        expect(runner.tick(hour(0)).executions[0]).toMatchObject({ completedGpuH: 0.25, remainingGpuH: 0.25, computeKWh: 0.2125 });
    });

    it("a protected reserve raised after acceptance cannot be used for urgent work", () => {
        const submitted = job({ workGpuH: 1, remainingGpuH: 1, window: hour(0) });
        const home = site("A", { storedKWh: 1, gridImportLimitKW: 0 }), runner = executor([submitted], [home]);
        expect(runner.accept(selection(submitted, home))).toBe(true);
        home.update(0, reading => { reading.supply!.protectedKWh = 1; });
        const observation = runner.tick(hour(0));
        expect(observation.feasible).toBe(true);
        expect(observation.executions[0]).toMatchObject({ completedGpuH: 0, remainingGpuH: 1, state: "missed" });
        expect(home.ledger.state().inventory.storedKWh).toBe(1);
    });

    it("requires a new allocation each tick and preserves receipt snapshots from mutation", () => {
        const submitted = job(), home = site("A"), runner = executor([submitted], [home]);
        expect(runner.accept(selection(submitted, home))).toBe(true);
        const first = runner.tick(hour(0));
        first.executions[0].remainingGpuH = 99;
        first.meters[0].gridImportKWh = 99;
        expect(runner.tick(hour(0)).executions[0].remainingGpuH).toBe(1);
        expect(runner.tick(hour(0)).meters[0].gridImportKWh).toBe(0.85);
        expect(runner.tick(hour(1)).executions[0]).toMatchObject({ completedGpuH: 0, remainingGpuH: 1 });
    });
});
