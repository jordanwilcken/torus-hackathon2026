import type { Job } from "../jobs/Job.type.js";
import type { JobOutcome } from "./JobOutcome.type.js";
export interface Router {
    /**
     * Unverified implementation obligation.
     * Submit the job to the shared current clearing round. Collect competing submissions before resolving outcomes; do not clear each route call as an independent market. Return selected true with the offered bid, awarded GPU count and clearing USD per GPU-hour, or selected false with an explanation and no award fields.
     * The selection policy can weight forecast evidence; forecasts cannot override eligibility constraints. Missing carbon forecasts are unavailable, never zero.
     * Select at most one award per job and never award the same site GPU or stored energy twice in a round. Honor shared slot limits, allowed locations, destination readiness and the budget-capped CapacityBid. Resolve ties deterministically; clearing price cannot exceed the winning bid.
     * Selection awards the current slot, not whole-job completion or a future reservation. Executor acceptance revalidates and reserves atomically. A failed search means no offer selected by this policy, not proof that no feasible schedule exists.
     * Preserve the configured planner and market policy, including the proposed uniform-price auction. Hard physical and utility constraints cannot be relaxed by urgency, soft carbon quotas, forecast weights or damping.
     */
    route(job: Job): Promise<JobOutcome>;
}
