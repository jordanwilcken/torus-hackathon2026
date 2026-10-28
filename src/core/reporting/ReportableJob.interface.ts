import type { Job } from "../jobs/Job.type.js";
import type { JobOutcome } from "../scheduling/JobOutcome.type.js";
import type { ImpactObservation } from "./ImpactObservation.interface.js";
import type { JobObservations } from "./JobObservations.type.js";

export interface ReportableJob {
    observeJob(job: Job): void;
    observeRouting(outcome: JobOutcome): void;
    observeRoutingFailure(error: unknown): void;
    observe(evidence: ImpactObservation): void;
    readObservations(): JobObservations;
}
