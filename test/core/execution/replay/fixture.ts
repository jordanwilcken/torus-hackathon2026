import type { ReplayScenario } from "../../../../src/core/execution/replay/Replay.types.js";
import supplied from "../../../../examples/replay/solar-shift.json";

export function threeHourScenario(): ReplayScenario {
    return structuredClone(supplied) as ReplayScenario;
}
