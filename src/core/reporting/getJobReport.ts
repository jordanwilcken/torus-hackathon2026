import type { JobReport } from "./JobReport.type.js";

/** UI read boundary; reporting/observation remains separate from routing. */
export function getJobReport(jobId: string, readReport: (jobId: string) => Promise<JobReport>) {
    return readReport(jobId);
}
