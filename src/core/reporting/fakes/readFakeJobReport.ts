import { getJobReport } from "../getJobReport.js";
import artifact from "./reports.json";
import type { JobReport } from "../JobReport.type.js";

/** Fake read of a saved report, not fabricated execution evidence for an arbitrary job. */
export async function readFakeJobReport(jobId: string): Promise<JobReport> {
    const saved = artifact.reports.find(report => report.jobId === jobId);
    if (saved) return { fake: true, label: artifact.label, ...structuredClone(saved) } as JobReport;
    const reason = "No report artifact is available for this job.";
    return {
        fake: true, label: artifact.label, jobId, comparison: "unavailable", scenario: reason,
        carbon: { unavailableReason: reason }, cost: { unavailableReason: reason },
    };
}

/** Preview wrapper choosing the Fake saved-report source. */
export function getFakeJobReport(jobId: string) {
    return getJobReport(jobId, readFakeJobReport);
}
