import type { Job } from "../jobs/Job.type.js";
import type { Executor } from "../execution/Executor.interface.js";
import type { Router } from "./Router.interface.js";
import type { JobOutcome } from "./JobOutcome.type.js";

export type JobRoutingResult = {
    jobId: string;
    selection: JobOutcome;
    accepted: boolean;
};

/**
 * The scheduler supplies unique jobs ready for routing. Earlier acceptances remain
 * if a later route or acceptance throws; this batch is not a transaction.
 */
export async function routeAndAcceptJobs(
    jobs: readonly Job[], router: Router, executor: Pick<Executor, "accept">,
): Promise<JobRoutingResult[]> {
    const queue = jobs.toSorted((a, b) =>
        Date.parse(a.window.endAt) - Date.parse(b.window.endAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const results: JobRoutingResult[] = [];
    for (const job of queue) {
        const selection = await router.route(job);
        const accepted = selection.selected ? executor.accept(selection) : false;
        results.push({ jobId: job.id, selection, accepted });
    }
    return results;
}
