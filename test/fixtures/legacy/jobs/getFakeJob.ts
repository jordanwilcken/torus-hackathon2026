import artifact from "./job.json";
import type { Job } from "../../../../src/core/jobs/Job.type.js";

/** Stand-in for the UI form or workload feed; routing never invents the incoming job. */
export function getFakeJob(id = artifact.job.id): Job {
    return { ...structuredClone(artifact.job), id } as Job;
}
