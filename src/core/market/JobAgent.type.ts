import type { Job } from "../jobs/Job.type.js";
import type { BidResponse } from "./BidResponse.type.js";
import type { CapacityBid } from "./CapacityBid.type.js";
export interface JobAgent {
    /**
     * Unverified implementation obligation.
     * Return at most one actual capacity bid for this job per round, identifying its offered-bid ID, requested positive integer GPUs and maximum USD per GPU-hour. With no qualifying offer, return an empty collection.
     * Use only matching job offers at allowed locations where the job is ready. A moving job cannot bid to execute at its destination before arrival; readiness at the origin is insufficient. Ignore done or missed jobs and guard zero remaining work or time before division.
     * Apply the budget cap before checking eligibility: affordable rate is min(policy value, available compute budget divided by remaining GPU-hours), after transfer costs. Bid only if that rate meets the slot reserve. Requested GPUs fit quoted capacity, maxGpus and remaining work. Urgency cannot authorize overspending.
     */
    bid(offers: Array<BidResponse>): Array<CapacityBid>;
}
export interface JobAgentConstructor {
    new (job: Job): JobAgent;
}
