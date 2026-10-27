import type { Job } from "../jobs/Job.type.js";
import type { JobOutcome } from "./JobOutcome.type.js";

export interface Router {
    /**
     * Select a current slot at its posted price, or return selected false with an explanation.
     * The scheduler calls this for queued jobs in earliest-deadline order, with job-id ties.
     * Selection is neither execution nor a firm future reservation; Executor.accept rechecks
     * the snapshot version and atomically reserves shared compute and local energy.
     *
     * Limit quantity to remaining slot GPUs (capGpus - usedGpus), the job's maxGpus,
     * remaining work and usable power/energy. Respect allowed locations, arrival/ready time,
     * protected storage, fixed load and utility limits. Urgency cannot relax hard limits.
     * GPU counts are integral; partial final work is metered as GPU-hours by the executor.
     *
     * Use labeled forecast evidence to compare eligible hours and sites, retaining its
     * source, accounting basis and timestamps in the allocation. Missing carbon is unknown,
     * not zero. Forecasts may advise waiting but never supply operating permission.
     * Transfer duration and overhead belong in the decision; remote execution waits for
     * arrival. Future feasibility must consider eligible sites, maxGpus and readiness.
     *
     * A failed search means this policy selected no slot, not proof that no schedule exists.
     * Reporting observes execution separately and never changes the outcome.
     */
    route(job: Job): Promise<JobOutcome>;
}
