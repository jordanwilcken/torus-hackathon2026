import type { Job } from "../jobs/Job.type.js";
import type { JobOutcome } from "../scheduling/JobOutcome.type.js";
import type { ImpactObservation } from "./ImpactObservation.interface.js";

export type JobObservations = {
    jobId: string;
    submittedJob?: Job;
    routingOutcome?: JobOutcome;
    routingFailure?: string;
    baseline?: ImpactObservation;
    selected?: ImpactObservation;
};
