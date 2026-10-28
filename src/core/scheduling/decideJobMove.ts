import type { Job } from "../jobs/Job.type.js";
import type { EnergyMap } from "../energy/EnergyMap.interface.js";
import type { ExecutionSite } from "../execution/runner/Executor.types.js";
import { assessJobPath, type JobPathAssessment } from "./assessJobPath.js";

export type MoveDecision = {
    move: boolean;
    reason: string;
    destinationLocationId: string;
    transferCarbonKg: number | null;
    stay?: JobPathAssessment;
    destination?: JobPathAssessment;
    avoidedCarbonKg?: number;
    netCarbonReductionKg?: number;
    stayCostUsd?: number;
    moveCostUsd?: number;
};
export type JobMoveOptions = {
    current: ExecutionSite;
    destination: ExecutionSite;
    asOf: string;
    maximumAgeMinutes: number;
    transfer: {
        readyAt: string;
        carbonKg: number | null;
        /** Complete transfer burden in USD. Posted execution prices already include energy and carbon. */
        costUsd?: number | null;
    };
};

/** Moving requires two feasible whole-job paths and a strict modeled carbon improvement.
 * Missing evidence is a stay, not a zero burden. Public offers remain projections, never reservations.
 * When transfer cost is supplied, destination posted job charges plus that cost must also improve.
 */
export function decideJobMove(job: Job, energyMap: EnergyMap, options: JobMoveOptions): MoveDecision {
    const { current, destination, transfer } = options;
    const decision: MoveDecision = {
        move: false, reason: "", destinationLocationId: destination.locationId,
        transferCarbonKg: transfer.carbonKg !== null && Number.isFinite(transfer.carbonKg) && transfer.carbonKg >= 0
            ? transfer.carbonKg : null,
    };
    const stay = (reason: string): MoveDecision => ({ ...decision, reason });
    if (current.locationId !== job.currentLocation || destination.locationId === current.locationId)
        return stay("A move needs the authoritative current site and a different destination.");
    if (!job.allowedLocations.includes(destination.locationId))
        return stay("The destination is not allowed for this job.");
    if (current.accountingBasis !== destination.accountingBasis)
        return stay("Current and destination carbon accounting bases do not match.");
    const now = Date.parse(options.asOf), arrival = Date.parse(transfer.readyAt);
    if (!Number.isFinite(now) || !Number.isFinite(arrival) || arrival < now || arrival >= Date.parse(job.window.endAt))
        return stay("Transfer arrival is invalid or leaves no execution time before the deadline.");
    if (decision.transferCarbonKg === null)
        return stay("Transfer carbon is unknown; no carbon reduction can be established.");
    if (transfer.costUsd !== undefined && (transfer.costUsd === null || !Number.isFinite(transfer.costUsd) || transfer.costUsd < 0))
        return stay("The supplied transfer monetary burden is unknown or invalid.");

    decision.stay = assessJobPath(job, energyMap, current, options);
    if (!decision.stay.feasible) return stay("Stay-path evidence is insufficient: " + decision.stay.reason);
    decision.destination = assessJobPath(job, energyMap, destination, { ...options, readyAt: transfer.readyAt });
    if (!decision.destination.feasible) return stay("Destination path is infeasible: " + decision.destination.reason);
    if (decision.stay.carbonKg === null || decision.destination.carbonKg === null)
        return stay("Whole-job carbon is unknown on one or both paths; stay rather than infer a benefit.");
    decision.avoidedCarbonKg = decision.stay.carbonKg - decision.destination.carbonKg;
    decision.netCarbonReductionKg = decision.avoidedCarbonKg - decision.transferCarbonKg;
    if (transfer.costUsd !== undefined) {
        decision.stayCostUsd = decision.stay.postedChargeUsd;
        decision.moveCostUsd = decision.destination.postedChargeUsd + transfer.costUsd!;
    }
    if (decision.netCarbonReductionKg <= 0)
        return stay("Avoided execution carbon does not exceed the modeled transfer carbon.");
    if (decision.moveCostUsd !== undefined && (!Number.isFinite(decision.moveCostUsd) || decision.moveCostUsd >= decision.stayCostUsd!))
        return stay("Destination execution plus transfer is not cheaper than completing the same job here.");
    return { ...decision, move: true,
        reason: "The assessed whole remaining job has lower modeled carbon after transfer" +
            (decision.moveCostUsd !== undefined ? " and lower total posted cost." : ".") +
            " Destination capacity still requires acceptance." };
}
