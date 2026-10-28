import type { PairedReplay, ReplayScenario } from "./Replay.types.js";
import { compareImpact, carbonReductionKg, modeledCostReductionUsd } from "../../reporting/impact/compareImpact.js";
import { prepareScenario } from "./prepareScenario.js";
import { runReplayArm } from "./runReplayArm.js";

/** Execute the same captured model twice, then compare actual simulator receipts. */
export async function runPairedReplay(supplied: ReplayScenario): Promise<PairedReplay> {
    const scenario = prepareScenario(supplied);
    const baseline = await runReplayArm(scenario, "baseline");
    const selected = await runReplayArm(scenario, "selected");
    const comparison = compareImpact({ jobId: scenario.jobs[0].id, baseline: baseline.impact, selected: selected.impact });
    return {
        schemaVersion: 1, label: scenario.label, scope: "modeled-fleet", scenario, baseline, selected, comparison,
        reductions: {
            carbonKg: carbonReductionKg(comparison.carbon) ?? null,
            modeledCostUsd: modeledCostReductionUsd(comparison.cost) ?? null,
        },
    };
}
