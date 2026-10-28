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
        terms.carbonGPerKWh === undefined || terms.electricityUsdPerMWh === undefined) return undefined;
    const plan = prepareTransfer(job, destination, asOf, terms,
        { origin: Date.parse(scenario.startAt), duration: 3_600_000 }, scenario.maximumAgeMinutes);
    if (!plan.started) return undefined;
    const evidence = plan.evidence;
    const costUsd = evidence.jobChargeUsd + evidence.electricityUsd! +
        evidence.carbonKg! * scenario.carbonPriceUsdPerTonne / 1000;
    const decision = scenario.routing?.movePolicy === "carbon-benefit" ? decideJobMove(job, energy, {
        current, destination, asOf, maximumAgeMinutes: scenario.maximumAgeMinutes,
        transfer: { readyAt: plan.readyAt, carbonKg: evidence.carbonKg ?? null, costUsd },
    }) : undefined;
    return { hours: (Date.parse(plan.readyAt) - Date.parse(asOf)) / 3_600_000, costUsd, decision };
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
            return result?.decision?.move === false ? undefined : result;
        },
    });
    const decisions = [...transfers.values()].flatMap(result => result?.decision ? [result.decision] : []);
    const requested = !outcome.selected ? outcome.transfer?.destination : undefined;
    const movement: MoveDecision | undefined = requested ? transfers.get(requested)?.decision
        : decisions.find(decision => !decision.move) ?? decisions[0];
    return movement ? { ...outcome, movement } : outcome;
}
