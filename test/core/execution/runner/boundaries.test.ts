import { describe, expect, it } from "vitest";
import { at, executor, hour, job, selection, site } from "./fixture.js";

describe("executor arrival and numeric boundaries", () => {
    it("admits an initial in-flight snapshot only when its initial readiness arrives", () => {
        const submitted = job({ readyAt: at(2), state: "moving", transferToLocation: "B" });
        const runner = executor([submitted], [site("A"), site("B")]);
        expect(runner.tick(hour(0)).executions).toEqual([]);
        expect(runner.tick(hour(1)).executions).toEqual([]);
        expect(runner.tick(hour(2)).executions).toEqual([expect.objectContaining({
            jobId: "batch", locationId: "B", state: "queued", completedGpuH: 0,
        })]);
    });

    it("does not report a submitted job until its initial readiness", () => {
        const submitted = job({ readyAt: at(2) }), home = site("A");
        const runner = executor([submitted], [home]);
        expect(runner.tick(hour(0)).executions).toEqual([]);
        expect(runner.tick(hour(1)).executions).toEqual([]);
        expect(runner.tick(hour(2)).executions).toEqual([expect.objectContaining({ jobId: "batch", completedGpuH: 0 })]);
    });

    it("retains all three GPUs when the published power contains binary64 rounding", () => {
        const submitted = job({ workGpuH: 3, remainingGpuH: 3, maxGpus: 3, window: { startAt: at(0), endAt: at(2) } });
        const home = site("A", { capGpus: 3, kWhPerGpuHour: 0.7 });
        const destination = site("B", { capGpus: 3, kWhPerGpuHour: 0.7, observedAt: at(0) });
        const runner = executor([submitted], [home, destination]);
        const move = runner.move(runner.job("batch")!, "B", at(0));
        expect(move.started).toBe(true);
        if (move.started) expect(move.readyAt).toBe(at(1));
    });

    it("rejects an unrepresentable final fraction before reserving or stranding work", () => {
        const submitted = job({ workGpuH: 1 / 7, remainingGpuH: 1 / 7 });
        const home = site("A"), runner = executor([submitted], [home]);
        const before = home.ledger.state();
        expect(runner.accept(selection(submitted, home, 0, { gpus: 1, estimatedKWh: 0.85 / 7 }))).toBe(false);
        expect(home.ledger.state()).toEqual(before);
        expect(runner.job("batch")).toMatchObject({ state: "queued", remainingGpuH: 1 / 7 });
    });

    it("stops new commands after a provider exception during a partially settled fleet tick", () => {
        const home = site("A"), destination = site("B");
        const waiting = job({ id: "waiting", homeLocation: "B", currentLocation: "B" });
        const originalDispatch = destination.executionSite.ledger.dispatch;
        destination.executionSite.ledger.dispatch = () => { throw new Error("Supply provider failed"); };
        const active = job({ workGpuH: 1, remainingGpuH: 1 });
        const runner = executor([active, waiting], [home, destination]);
        expect(runner.accept(selection(active, home))).toBe(true);
        expect(() => runner.tick(hour(0))).toThrow("Supply provider failed");
        expect(runner.job(active.id)).toMatchObject({ state: "done", remainingGpuH: 0 });
        expect(home.ledger.state().nextWindow).toEqual(hour(1));
        destination.executionSite.ledger.dispatch = originalDispatch;
        const before = destination.ledger.state();
        expect(runner.accept(selection(waiting, destination))).toBe(false);
        expect(destination.ledger.state()).toEqual(before);
        expect(runner.tick(hour(0)).feasible).toBe(false);
    });
});
