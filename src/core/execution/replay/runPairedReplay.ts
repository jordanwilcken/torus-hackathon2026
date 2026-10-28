import type { PairedReplay, ReplayScenario } from "./Replay.types.js";
import { compareReplay } from "./compareReplay.js";
import { prepareScenario } from "./prepareScenario.js";
import { runReplayArm } from "./runReplayArm.js";

/** Execute the same captured model twice, then compare actual simulator receipts. */
export async function runPairedReplay(supplied: ReplayScenario): Promise<PairedReplay> {
    const scenario = prepareScenario(supplied);
    const baseline = await runReplayArm(scenario, "baseline");
    const selected = await runReplayArm(scenario, "selected");
    return compareReplay(scenario, baseline, selected);
}
