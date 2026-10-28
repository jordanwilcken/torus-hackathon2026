import type { Job } from "../../jobs/Job.type.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { JobExecution } from "../JobExecution.type.js";
import type { SiteEnergyAssessment, SiteEnergyLoad, SiteEnergyUsage } from "../../energy/site/SiteEnergy.types.js";
import type { ExecutionSite } from "./Executor.types.js";
import type { AcceptedAllocation } from "./acceptAllocation.js";
import { bounds, near } from "./executionTime.js";
import * as time from "./math/time.generated.js";
import * as work from "./math/execution.generated.js";

export type CompletedWork = Pick<JobExecution, "completedGpuH" | "computeKWh" | "postedChargeUsd">;
type SiteSettlement = {
    result: SiteEnergyAssessment;
    computeExecuted: boolean;
    explanations: string[];
};

/** Settle one site, retrying only idle demand if accepted compute is infeasible.
 * Successful idle settlement does not mean the proposed compute executed.
 */
export function dispatchSiteTick(site: ExecutionSite, window: TimeWindow, loads: SiteEnergyLoad[]): SiteSettlement {
    const explanations: string[] = [];
    let result = site.ledger.dispatch({ window, loads });
    const computeExecuted = result.feasible;
    if (!computeExecuted && loads.length) {
        explanations.push(`${site.locationId}: accepted compute paused after revalidation (${result.reason}).`);
        // Failed dispatch leaves the ledger unchanged, so fixed load can still settle this tick.
        result = site.ledger.dispatch({ window, loads: [] });
    }
    if (!result.feasible)
        explanations.push(`${site.locationId}: ${result.reason ?? "Site supply is infeasible."}`);
    return { result, computeExecuted, explanations };
}

/** Advance the owned job only after its accepted load actually ran.
 * The prepared load has a valid window, and usage comes from that site's ledger receipt.
 */
export function applyAllocationUsage(job: Job, allocation: AcceptedAllocation, usage: SiteEnergyUsage): CompletedWork {
    const [start, end] = bounds(allocation.load.window)!;
    const durationMs = time.elapsedMilliseconds({ start, end });
    const completedGpuH = work.completedWork({ remainingGpuH: job.remainingGpuH, gpus: allocation.load.gpus, durationMs });
    const remaining = work.remainingWork({ remainingGpuH: job.remainingGpuH, completedGpuH });
    job.remainingGpuH = near(remaining, 0) ? 0 : remaining;
    job.state = job.remainingGpuH === 0 ? "done" : "running";
    const directKWh = work.directComputeEnergy(usage);
    return {
        completedGpuH,
        computeKWh: work.totalComputeEnergy({ directKWh, batteryKWh: usage.batteryKWh }),
        postedChargeUsd: work.postedCharge({ completedGpuH, postedUsdPerGpuHour: allocation.postedUsdPerGpuHour }),
    };
}
