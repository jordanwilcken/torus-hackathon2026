import type { JobExecution } from "./JobExecution.type.js";
import type { SiteMeter } from "./SiteMeter.type.js";
export type TickObservation = {
    feasible: boolean;
    executions: Array<JobExecution>;
    meters: Array<SiteMeter>;
    explanation?: string | undefined;
};
