import type { Job } from "../../jobs/Job.type.js";
import type { JobOutcome } from "../../scheduling/JobOutcome.type.js";
import type { ImpactObservation } from "../ImpactObservation.interface.js";
import type { JobObservations } from "../JobObservations.type.js";
import type { ReportableJob } from "../ReportableJob.interface.js";

export function reportableJob(jobId: string): ReportableJob {
    return new ObservedJob(jobId);
}

export function withReporting<T extends JobOutcome>(
    routeJob: (job: Job) => Promise<T>,
    observer: ReportableJob,
): (job: Job) => Promise<T> {
    return async job => {
        if (job.id !== observer.readObservations().jobId) return routeJob(job);
        observer.observeJob(job);
        let outcome: T;
        try {
            outcome = await routeJob(job);
        } catch (error) {
            try { observer.observeRoutingFailure(error); }
            finally { throw error; }
        }
        observer.observeRouting(outcome);
        return outcome;
    };
}

class ObservedJob implements ReportableJob {
    private observations: JobObservations;

    constructor(private readonly jobId: string) {
        this.observations = { jobId };
    }

    observeJob = (job: Job): void => {
        if (job.id !== this.jobId) return;
        this.observations = { jobId: this.jobId, submittedJob: structuredClone(job) };
    };

    observeRouting = (outcome: JobOutcome): void => {
        this.observations.routingOutcome = structuredClone(outcome);
        this.observations.routingFailure = undefined;
    };

    observeRoutingFailure = (error: unknown): void => {
        this.observations.routingOutcome = undefined;
        this.observations.routingFailure = error instanceof Error ? error.message : String(error);
    };

    observe = (evidence: ImpactObservation): void => {
        if (evidence.jobId !== this.jobId) return;
        this.observations[evidence.arm] = structuredClone(evidence);
    };

    readObservations = (): JobObservations => structuredClone(this.observations);
}
