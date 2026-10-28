import type { Job } from "../../jobs/Job.type.js";
import type { SiteEnergyConfiguration, SiteEnergyInput } from "../../energy/site/SiteEnergy.types.js";
import type { SimulationLogEntry, InputEvent } from "../simulation/clock.js";
import type { ExecutionRun } from "../../reporting/ExecutionEvidence.type.js";
import type { ImpactObservation } from "../../reporting/ImpactObservation.interface.js";
import type { JobReport } from "../../reporting/JobReport.type.js";
import type { JobRoutingResult } from "../../scheduling/routeAndAcceptJobs.js";

/** Captured, JSON-serializable model inputs with hourly admission.
 * Jobs start queued at home; readyAt and window.startAt are UTC hour boundaries.
 * No live data, processes, automatic migration or mutable providers.
 */
export type ReplayScenario = {
    schemaVersion: 1;
    id: string;
    inputRevision: string;
    label: string;
    seed: number;
    startAt: string;
    hours: number;
    jobs: Job[];
    sites: {
        configuration: SiteEnergyConfiguration;
        computeProfile: string;
        /** Projections issued by startAt. They never become observations implicitly. */
        forecast: SiteEnergyInput[];
        /** Revealed at the start of their own canonical tick, only if already known. */
        observations: SiteEnergyInput[];
    }[];
    carbonPriceUsdPerTonne: number;
    maximumAgeMinutes: number;
    storageToleranceKWh: number;
    events?: InputEvent[];
};

export type ReplayArm = {
    policy: "home-fifo-immediate-v1" | "home-edf-priced-wait-v1";
    run: ExecutionRun;
    impact: ImpactObservation;
    decisions: Array<{ hour: number; results: JobRoutingResult[] }>;
    log: SimulationLogEntry[];
    finalJobs: Job[];
};

export type PairedReplay = {
    schemaVersion: 1;
    label: string;
    scope: "modeled-fleet";
    scenario: ReplayScenario;
    baseline: ReplayArm;
    selected: ReplayArm;
    /** One fleet comparison, not per-job totals to sum. */
    comparison: Pick<JobReport, "comparison" | "carbon" | "cost">;
    reductions: { carbonKg: number | null; modeledCostUsd: number | null };
};
