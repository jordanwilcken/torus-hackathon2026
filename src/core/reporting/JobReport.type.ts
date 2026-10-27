import type { CarbonReport } from "./CarbonReport.type.js";
import type { CostReport } from "./CostReport.type.js";

/** Readable report data, separate from the component that observes execution. */
export type JobReport = {
    fake: boolean;
    label: string;
    jobId: string;
    comparison: "illustrative" | "comparable" | "not-comparable" | "unavailable";
    scenario: string;
    carbon: CarbonReport;
    cost: CostReport;
};
