import type { Job } from "../../jobs/Job.type.js";
import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import { chooseExecutionSlot } from "../../scheduling/chooseExecutionSlot.js";
import { decideJobMove, type MoveDecision } from "../../scheduling/decideJobMove.js";
import { prepareTransfer } from "../runner/prepareTransfer.js";
import type { ExecutionSite } from "../runner/Executor.types.js";
import type { ReplayScenario } from "./Replay.types.js";

/** Same transfer feasibility and burden for the capacity planner and the actual route. */
export function replayTransferDecision(job: Job, energy: EnergyMap, scenario: ReplayScenario,
    sites: readonly ExecutionSite[], asOf: string, destinationId: string) {
    const current = sites.find(site => site.locationId === job.currentLocation);
    const destination = sites.find(site => site.locationId === destinationId);
    const terms = scenario.routing?.transfer;
    if (!current || !destination || !terms || !job.allowedLocations.includes(destinationId) ||
        destination.computeProfile !== job.computeProfile || terms.accountingBasis !== current.accountingBasis ||
        terms.electricityUsdPerMWh === undefined) return undefined;
    const plan = prepareTransfer(job, destination, asOf, terms,
        { origin: Date.parse(scenario.startAt), duration: 3_600_000 }, scenario.maximumAgeMinutes);
    if (!plan.started) return undefined;
    const evidence = plan.evidence;
    // A zero carbon price has a known zero monetary charge even when transfer emissions are unknown.
    // Positive carbon pricing still needs the missing burden before a complete price can be quoted.
    const carbonChargeUsd = scenario.carbonPriceUsdPerTonne === 0 ? 0 : evidence.carbonKg === undefined
        ? undefined : evidence.carbonKg * scenario.carbonPriceUsdPerTonne / 1000;
    if (carbonChargeUsd === undefined) return undefined;
    const costUsd = evidence.jobChargeUsd + evidence.electricityUsd! + carbonChargeUsd;
    const decision = scenario.routing?.movePolicy === "carbon-benefit" ? decideJobMove(job, energy, {
        current, destination, asOf, maximumAgeMinutes: scenario.maximumAgeMinutes,
        transfer: { readyAt: plan.readyAt, carbonKg: evidence.carbonKg ?? null, costUsd },
    }) : undefined;
    return { hours: (Date.parse(plan.readyAt) - Date.parse(asOf)) / 3_600_000, costUsd, decision,
        ...(decision?.move && decision.moveCostUsd !== undefined ? { approvedJobCostUsd: decision.moveCostUsd } : {}) };
}

/** Plan over current ledger publications; the executor independently validates every command. */
export async function routeReplayJob(job: Job, energy: EnergyMap, scenario: ReplayScenario,
    sites: readonly ExecutionSite[], asOf: string, fleet: boolean, movementEnergy: EnergyMap = energy) {
    const current = sites.find(site => site.locationId === job.currentLocation)!;
    const transfers = new Map<string, ReturnType<typeof replayTransferDecision>>();
    const outcome = await chooseExecutionSlot(fleet ? job : { ...job, allowedLocations: [job.homeLocation] }, energy, {
        asOf, maximumAgeMinutes: scenario.maximumAgeMinutes, kWhPerGpuHour: current.kWhPerGpuHour,
        planTransfers: fleet,
        transferTo(locationId) {
            if (!fleet) return undefined;
            if (!transfers.has(locationId)) transfers.set(locationId,
                replayTransferDecision(job, movementEnergy, scenario, sites, asOf, locationId));
            const result = transfers.get(locationId);
            return result?.decision?.move === false ? { rejectedBecause: result.decision.reason } : result;
        },
    });
    const requested = !outcome.selected ? outcome.transfer?.destination : undefined;
    const movement: MoveDecision | undefined = requested ? transfers.get(requested)?.decision : undefined;
    return movement ? { ...outcome, movement } : outcome;
}
