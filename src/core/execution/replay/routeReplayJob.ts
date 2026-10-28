import type { Job } from "../../jobs/Job.type.js";
import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import { chooseExecutionSlot } from "../../scheduling/chooseExecutionSlot.js";
import { prepareTransfer } from "../runner/prepareTransfer.js";
import type { ExecutionSite } from "../runner/Executor.types.js";
import type { ReplayScenario } from "./Replay.types.js";

/** Plan over current ledger publications; the executor independently validates every command. */
export function routeReplayJob(job: Job, energy: EnergyMap, scenario: ReplayScenario,
    sites: readonly ExecutionSite[], asOf: string, fleet: boolean) {
    const current = sites.find(site => site.locationId === job.currentLocation)!;
    const transfers = new Map<string, { hours: number; costUsd: number } | undefined>();
    return chooseExecutionSlot(fleet ? job : { ...job, allowedLocations: [job.homeLocation] }, energy, {
        asOf, maximumAgeMinutes: scenario.maximumAgeMinutes, kWhPerGpuHour: current.kWhPerGpuHour,
        planTransfers: fleet,
        transferTo(locationId) {
            if (transfers.has(locationId)) return transfers.get(locationId);
            transfers.set(locationId, undefined);
            const terms = scenario.routing?.transfer;
            const destination = sites.find(site => site.locationId === locationId);
            if (!fleet || !terms || !destination || terms.accountingBasis !== current.accountingBasis ||
                terms.carbonGPerKWh === undefined || terms.electricityUsdPerMWh === undefined) return undefined;
            const plan = prepareTransfer(job, destination, asOf, terms,
                { origin: Date.parse(scenario.startAt), duration: 3_600_000 }, scenario.maximumAgeMinutes);
            if (!plan.started) return undefined;
            const evidence = plan.evidence;
            // Same declared policy as the final report; no missing burden is silently zero-priced.
            const costUsd = evidence.jobChargeUsd + evidence.electricityUsd! +
                evidence.carbonKg! * scenario.carbonPriceUsdPerTonne / 1000;
            const result = { hours: (Date.parse(plan.readyAt) - Date.parse(asOf)) / 3_600_000, costUsd };
            transfers.set(locationId, result);
            return result;
        },
    });
}
