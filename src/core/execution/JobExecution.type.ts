/** Number profile: JavaScript binary64. */
import type { TimeWindow } from "../TimeWindow.type.js";
import type { JobState } from "../jobs/JobState.type.js";
export type JobExecution = {
    jobId: string;
    locationId: string;
    window: TimeWindow;
    completedGpuH: number;
    remainingGpuH: number;
    state: JobState;
    computeKWh: number;
    postedChargeUsd: number;
};
