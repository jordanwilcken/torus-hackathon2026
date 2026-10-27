import type { Job } from "../jobs/Job.type.js";
import type { BidResponse } from "./BidResponse.type.js";
export interface SiteAgent {
    /**
     * Unverified implementation obligation.
     * Return only actual eligible bids. Every response contains a bid identifying its job, site and energy slot. An agent that cannot bid returns an empty collection and emits no bid response.
     * Respect job requirements, compute capacity and Torus power/energy available after protected reserves and utility commitments. Bidding does not reserve capacity.
     * Bid only for understood profiles at allowed locations. Quote current-slot capacity, not the whole job. quotedGpus is a positive integer within slot and job GPU limits. Energy buckets are nonempty, ordered, nonoverlapping and inside the job and slot windows; required power and total energy fit the referenced version.
     * Every energy bucket has positive duration and nonnegative energy. Required power is nonnegative; each bucket's estimated kWh is at most requiredPowerKW multiplied by its duration in hours.
     * Under the declared constant-power GPU model, kWhPerGpuHour is positive and requiredPowerKW covers quotedGpus times kWhPerGpuHour while those GPUs run. A partial final tick reduces energy and payment, not active power; spreading that energy across the whole slot cannot evade the power limit.
     * Quote energy for min(remainingGpuH, quotedGpus times slot hours) using the declared kWhPerGpuHour, which includes its stated cooling boundary. Partial awards are accounted from actual executed GPU-hours, not an unscaled whole-offer estimate. Slot reserves use USD per GPU-hour; electricity USD per MWh and carbon USD per tonne require conversion before comparison.
     * Retain the forecast snapshot used. Carbon is gCO2/kWh, regional demand MW and local solar kW; each retains source, scope, basis and timestamps. Historical observations cannot be relabeled as forecasts; a separately labeled model is required. Demand cannot substitute for carbon. Synthetic future-actual-plus-noise fixtures do not establish predictive skill.
     * When estimating carbon, align energy and carbon time buckets and declare any within-bucket allocation assumption. Incomplete coverage stays unknown. Regional grid intensity alone does not establish emissions of a site's storage-backed supply.
     */
    bid(job: Job): Promise<Array<BidResponse>>;
}
