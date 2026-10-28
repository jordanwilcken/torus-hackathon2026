import type { JobReport } from "./JobReport.type.js";
import type { JobObservations } from "./JobObservations.type.js";
import { compareImpact } from "./impact/compareImpact.js";

export function getJobReport(jobId: string, readReport: (jobId: string) => Promise<JobReport>) {
    return readReport(jobId);
}

export function createJobReport(
    observations: JobObservations,
    source: Pick<JobReport, "fake" | "label"> = { fake: false, label: "Observed job flow" },
): JobReport {
    const { jobId, submittedJob, routingOutcome, routingFailure, baseline, selected } = observations;
    return {
        ...source,
        jobId,
        submittedJob: structuredClone(submittedJob),
        routingOutcome: structuredClone(routingOutcome),
        routingFailure,
        ...compareImpact(observations),
        scenario: baseline && selected
            ? "Supplied baseline and selected comparison observations."
            : submittedJob ? "Job flow observed; execution has not been observed." : "No job has been submitted.",
    };
}
