import type { ExecutionSummary } from "./ExecutionEvidence.type.js";
import type { Job } from "../jobs/Job.type.js";
import type { JobOutcome } from "../scheduling/JobOutcome.type.js";
import type { CarbonReport } from "./CarbonReport.type.js";
import type { CostReport } from "./CostReport.type.js";

/** Readable report data, separate from the component that observes execution. */
export type JobReport = {
    fake: boolean;
    label: string;
    jobId: string;
    submittedJob?: Job;
    routingOutcome?: JobOutcome;
    routingFailure?: string;
    comparison: "illustrative" | "comparable" | "not-comparable" | "unavailable";
    scenario: string;
    execution?: { baseline?: ExecutionSummary; selected?: ExecutionSummary };
    carbon: CarbonReport;
    cost: CostReport;
};
