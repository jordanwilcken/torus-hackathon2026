import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import { createEnergyMap } from "../../energy/maps/createEnergyMap.js";
import { createSiteEnergyLedger } from "../../energy/site/createSiteEnergyLedger.js";
import type { Job } from "../../jobs/Job.type.js";
import { summarizeExecution } from "../../reporting/impact/summarizeExecution.js";
import type { ExecutionRun } from "../../reporting/ExecutionEvidence.type.js";
import { chooseExecutionSlot } from "../../scheduling/chooseExecutionSlot.js";
import { quoteSiteEnergy } from "../../scheduling/quoteSiteEnergy.js";
import { routeAndAcceptJobs } from "../../scheduling/routeAndAcceptJobs.js";
import { createExecutor } from "../runner/createExecutor.js";
import { createSimulation, type PhaseContext } from "../simulation/clock.js";
import { hourStart } from "../simulation/workload.js";
import type { ReplayArm, ReplayScenario } from "./Replay.types.js";

/** Each invocation owns all mutable state. Inputs have been captured and checked by prepareScenario. */
export async function runReplayArm(scenario: ReplayScenario, arm: "baseline" | "selected"): Promise<ReplayArm> {
    const horizon = { startAt: scenario.startAt, endAt: hourStart(scenario.startAt, scenario.hours) };
    const sites = scenario.sites.map(site => {
        const configuration = site.configuration;
        return {
            locationId: configuration.locationId, computeProfile: site.computeProfile,
            kWhPerGpuHour: configuration.compute.kWPerGpu, accountingBasis: configuration.accountingBasis,
            ledger: createSiteEnergyLedger(configuration, site.forecast, offer => quoteSiteEnergy(offer, {
                kWhPerGpuHour: configuration.compute.kWPerGpu,
                carbonPriceUsdPerTonne: scenario.carbonPriceUsdPerTonne,
                accountingBasis: configuration.accountingBasis,
            })),
        };
    });
    const energy = createEnergyMap({
        window: horizon,
        sites: sites.map(site => ({ locationId: site.locationId, computeProfile: site.computeProfile, regionId: "declared-scenario" })),
    }, {
        siteEnergy: { slots: (location, window) => sites.find(site => site.locationId === location)?.ledger.slots(location, window) ?? [] },
        // Local forecast supply is explicitly in the scenario. No regional forecast is invented.
        regionalGrid: { read: () => ({ observations: [], forecast: {} }) },
    });
    const executor = createExecutor({ jobs: scenario.jobs, sites, maximumAgeMinutes: scenario.maximumAgeMinutes,
        transferTerms: () => undefined });
    const run: ExecutionRun = {
        comparisonId: scenario.id, inputRevision: scenario.inputRevision, arm, jobId: scenario.jobs[0].id,
        horizon, accountingBasis: sites[0].accountingBasis, source: scenario.label, simulated: true,
        storageToleranceKWh: scenario.storageToleranceKWh, jobs: structuredClone(scenario.jobs),
        sites: scenario.sites.map(site => ({
            locationId: site.configuration.locationId, initialStoredKWh: site.configuration.storage.initial.storedKWh,
        })),
        ticks: [], transfers: [],
        costPolicy: { basis: "Modeled electricity plus carbon; no transfers", carbonPriceUsdPerTonne: scenario.carbonPriceUsdPerTonne },
    };
    const ticks: Array<ExecutionRun["ticks"][number]> = [];
    const decisions: ReplayArm["decisions"] = [];
    const simulation = createSimulation({
        seed: scenario.seed, snapshotId: scenario.inputRevision, startAt: scenario.startAt, hours: scenario.hours,
        syntheticForecast: true, workload: { kind: "fixture", jobs: scenario.jobs },
    }, { energy, createPhases: () => ({
        observe(context) {
            scenario.sites.forEach((site, index) => {
                const observed = site.observations[context.hour];
                if (Date.parse(observed.evidence.observedAt) <= Date.parse(context.asOf))
                    sites[index].ledger.update(observed);
            });
        },
        async shop(context) {
            // The executor owns remaining work and location. The clock owns admission/deadline visibility.
            const jobs = context.jobs.map(job => executor.job(job.id)!)
                .filter(job => job.state === "queued" || job.state === "running");
            const route = async (job: Job) => chooseExecutionSlot(
                { ...job, allowedLocations: [job.homeLocation] }, policyView(context, arm), {
                    asOf: context.asOf, maximumAgeMinutes: scenario.maximumAgeMinutes,
                    kWhPerGpuHour: sites.find(site => site.locationId === job.homeLocation)!.kWhPerGpuHour,
                    transferTo: () => undefined,
                });
            if (arm === "selected") {
                decisions.push({ hour: context.hour, results: await routeAndAcceptJobs(jobs, { route }, executor) });
            } else {
                const results: ReplayArm["decisions"][number]["results"] = [];
                for (const job of jobs.toSorted(fifoOrder)) {
                    const selection = await route(job);
                    results.push({ jobId: job.id, selection, accepted: selection.selected ? executor.accept(selection) : false });
                }
                decisions.push({ hour: context.hour, results });
            }
        },
        execute(context) {
            const observation = executor.tick(context.tick);
            ticks.push(observation);
            return observation;
        },
    }) });
    while (simulation.hour < scenario.hours) {
        await simulation.step();
        // Keep partial observations. Continuing after a stopped ledger would manufacture coverage.
        if (ticks.at(-1)?.feasible === false) break;
    }
    run.ticks = ticks;
    return {
        policy: arm === "baseline" ? "home-fifo-immediate-v1" : "home-edf-priced-wait-v1",
        run, impact: summarizeExecution(run), decisions, log: simulation.log(),
        finalJobs: scenario.jobs.map(job => executor.job(job.id)!),
    };
}

function policyView(context: PhaseContext, arm: "baseline" | "selected"): EnergyMap {
    if (arm === "selected") return context.energy;
    return {
        ...context.energy,
        // Only present-hour offers: FIFO does not wait in response to future posted prices.
        findSlots: query => context.energy.findSlots({ ...query, window: context.tick }),
    };
}

function fifoOrder(a: Job, b: Job): number {
    const first = Date.parse(a.readyAt), second = Date.parse(b.readyAt);
    if (first !== second) return first < second ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
