import type { PairedReplay, ReplayArm, ReplayScenario } from "./Replay.types.js";
import { compareImpact, carbonReductionKg, modeledCostReductionUsd } from "../../reporting/impact/compareImpact.js";

export function compareReplay(scenario: ReplayScenario, baseline: ReplayArm, selected: ReplayArm): PairedReplay {
    const comparison = compareImpact({ jobId: scenario.jobs[0].id, baseline: baseline.impact, selected: selected.impact });
    return {
        schemaVersion: 1, label: scenario.label, scope: "modeled-fleet", scenario: structuredClone(scenario),
        baseline, selected, comparison,
        reductions: {
            carbonKg: carbonReductionKg(comparison.carbon) ?? null,
            modeledCostUsd: modeledCostReductionUsd(comparison.cost) ?? null,
        },
    };
}
