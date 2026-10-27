import type { Job } from "../jobs/Job.type.js";
import type { JobOutcome } from "./JobOutcome.type.js";
import type { Router } from "./Router.interface.js";

/** Submission boundary; the caller chooses the routing implementation. */
export function route(job: Job, router: Router): Promise<JobOutcome> {
    return router.route(job);
}
