import type { InputEvent } from "../simulation/clock.js";
import type { ReplayScenario } from "./Replay.types.js";
import { prepareScenario } from "./prepareScenario.js";
import { createReplayArmSession } from "./runReplayArm.js";
import { compareReplay } from "./compareReplay.js";
import { validateReplayEvent } from "./replayEvents.js";

export type ReplayPhase = "ready" | "routed" | "settled" | "complete";

export function createPairedReplaySession(supplied: ReplayScenario) {
    const scenario = prepareScenario(supplied);
    const baseline = createReplayArmSession(scenario, "baseline");
    const selected = createReplayArmSession(scenario, "selected");
    let phase: ReplayPhase = "ready";
    let hour = 0;
    let running = false, ended = false, broken = false;
    const read = () => ({
        hour, totalHours: scenario.hours, phase, done: ended,
        armHours: { baseline: baseline.hour, selected: selected.hour },
        armDone: { baseline: baseline.done, selected: selected.done },
        scenario: structuredClone(scenario), baseline: baseline.read(), selected: selected.read(),
        map: selected.publication(),
    });
    return {
        read,
        async step(onRouted?: (progress: ReturnType<typeof read>) => void | Promise<void>) {
            if (running) throw new Error("A paired replay step is already running.");
            if (broken) throw new Error("This replay failed; construct a fresh session before retrying.");
            if (ended) return read();
            running = true;
            try {
                await baseline.step();
                await selected.step(async () => {
                    phase = "routed";
                    await onRouted?.(read());
                });
                hour = Math.max(baseline.hour, selected.hour);
                ended = baseline.done && selected.done;
                phase = ended ? "complete" : "settled";
                return read();
            } catch (error) {
                broken = true;
                throw error;
            } finally {
                running = false;
            }
        },
        schedule(input: InputEvent) {
            if (running || broken || ended) throw new Error("Schedule events between active replay steps.");
            const event = structuredClone(input);
            validateReplayEvent(scenario, event, hour);
            if (!baseline.done) baseline.schedule(event);
            if (!selected.done) selected.schedule(event);
            scenario.events = [...scenario.events ?? [], event];
        },
        result() {
            if (!ended) throw new Error("Complete the replay before exporting a comparison.");
            return compareReplay(scenario, baseline.read(), selected.read());
        },
    };
}
export type ReplayProgress = ReturnType<ReturnType<typeof createPairedReplaySession>["read"]>;
