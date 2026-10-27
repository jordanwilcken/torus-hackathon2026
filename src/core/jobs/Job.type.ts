/** Number profile: JavaScript binary64. */
import type { TimeWindow } from "../TimeWindow.type.js";
import type { JobState } from "./JobState.type.js";
export type Job = {
    id: string;
    workloadRef: string;
    computeProfile: string;
    window: TimeWindow;
    allowedLocations: Array<string>;
    homeLocation: string;
    currentLocation: string;
    transferToLocation?: string | undefined;
    readyAt: string;
    workGpuH: number;
    remainingGpuH: number;
    maxGpus: number;
    budgetLeftUsd: number;
    carbonTargetGPerKWh?: number | undefined;
    dataGB: number;
    state: JobState;
};
