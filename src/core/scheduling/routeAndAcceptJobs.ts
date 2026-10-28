import type { Job } from "../jobs/Job.type.js";
import type { Executor } from "../execution/Executor.interface.js";
import type { Router } from "./Router.interface.js";
import type { TransferOutcome } from "../execution/TransferOutcome.type.js";
import type { JobOutcome } from "./JobOutcome.type.js";

export type JobRoutingResult = {
    jobId: string;
    selection: JobOutcome;
    accepted: boolean;
    /** Actual move outcome stays separate from a proposed transfer and accepted compute. */
    transfer?: TransferOutcome;
};

/**
 * The scheduler supplies unique jobs ready for routing. Earlier acceptances remain
 * if a later route or acceptance throws; this batch is not a transaction.
 */
export async function routeAndAcceptJobs(
    jobs: readonly Job[], router: Router, executor: Pick<Executor, "accept"> & Partial<Pick<Executor, "move">>,
): Promise<JobRoutingResult[]> {
    const queue = jobs.toSorted((a, b) =>
        Date.parse(a.window.endAt) - Date.parse(b.window.endAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const results: JobRoutingResult[] = [];
    for (const job of queue) {
        const selection = await router.route(job);
        const accepted = selection.selected ? executor.accept(selection) : false;
        const transfer = !selection.selected && selection.transfer && executor.move
            ? executor.move(job, selection.transfer.destination, selection.transfer.startsAt) : undefined;
        results.push({ jobId: job.id, selection, accepted, ...(transfer ? { transfer } : {}) });
    }
    return results;
}
