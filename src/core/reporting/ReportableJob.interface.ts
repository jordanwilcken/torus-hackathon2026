/** Number profile: JavaScript binary64. */
import type { ImpactObservation } from "./ImpactObservation.interface.js";
import type { CarbonReport } from "./CarbonReport.type.js";
import type { CostReport } from "./CostReport.type.js";
export interface ReportableJob {
    /**
     * Unverified implementation obligation.
     * Collect reporting evidence for this job from process observations or an outer wrapper, without changing the router's result or selection policy.
     * Keep baseline and selected evidence for the same comparison revision, work cohort, horizon and accounting basis. Use the same modeled assets, initial state, dispatch policy and hard constraints. Observe fleet-wide execution/meter evidence and declared transfers, including continuing idle load, rather than infer savings from route selection. Do not combine different attempts.
     */
    observe(evidence: ImpactObservation): void;
    /** Return raw totals with the declared basis and a reason when reduction is unavailable. */
    carbon(): CarbonReport;
    cost(): CostReport;
    /**
     * Derive baseline modeled cost minus selected modeled cost only for comparable work,
     * known totals and the same nonempty costBasis (including carbon price). Otherwise
     * return unknown. Use realized meters and transfer effects under that policy, not
     * forecast quotes. This is modeled energy + carbon cost, not a utility bill saving.
     */
    modeledCostReductionUsd(): number | undefined;
    /**
     * Unverified implementation obligation.
     * Return true only with compatible evidence, the same jobs fully completed with equal completed work, and matching per-site ending storage within the declared tolerance. Missing, incomplete or physically infeasible evidence is not comparable. Raw carbon totals may still be displayed.
     */
    comparable(): boolean;
    /**
     * Unverified implementation obligation.
     * Derive baselineCarbonKg minus selectedCarbonKg only when comparable and both inputs are known. Never store a separately writable reduction. Otherwise return unknown; retain negative results as increases. Never treat reduced completed work, depleted storage or a posted scheduling charge as measured carbon or electricity savings.
     */
    carbonReductionKg(): number | undefined;
}
