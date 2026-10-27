import artifact from "./job.json";
import type { Job } from "../Job.type.js";

/** Stand-in for the UI form or workload feed; routing never invents the incoming job. */
export function getFakeJob(): Job {
    return structuredClone(artifact.job) as Job;
}
