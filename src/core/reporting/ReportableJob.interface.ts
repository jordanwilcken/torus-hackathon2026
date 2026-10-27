/** Number profile: JavaScript binary64. */
import type { Job } from "../jobs/Job.type.js";
import type { CarbonObservation } from "./CarbonObservation.interface.js";
import type { CarbonReport } from "./CarbonReport.type.js";
export interface ReportableJob {
    /**
     * Unverified implementation obligation.
     * Collect reporting evidence for this job from process observations or an outer wrapper, without changing the router's result or selection policy.
     * Keep baseline and selected evidence for the same comparison revision, work cohort, horizon and accounting basis. Use the same modeled assets, initial state and hard constraints. Observe fleet-wide execution/meter evidence and declared transfers, including continuing idle load, rather than infer savings from route selection. Do not combine different attempts.
     */
    observe(evidence: CarbonObservation): void;
    carbon(): CarbonReport;
    /**
     * Unverified implementation obligation.
     * Return true only with compatible evidence, the same jobs fully completed with equal completed work, and matching per-site ending storage within the declared tolerance. Missing, incomplete or physically infeasible evidence is not comparable. Raw carbon totals may still be displayed.
     */
    comparable(): boolean;
    /**
     * Unverified implementation obligation.
     * Derive baselineCarbonKg minus selectedCarbonKg only when comparable and both inputs are known. Never store a separately writable reduction. Otherwise return unknown; retain negative results as increases. Never treat reduced completed work, depleted storage or an auction payment as measured carbon or electricity savings.
     */
    carbonReductionKg(): number | undefined;
}
export interface ReportableJobConstructor {
    new (job: Job): ReportableJob;
}
