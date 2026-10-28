import type { CapacityPlanningPolicy, HourlyCapacityPlan } from "../../energy/planning/CapacityPlan.types.js";
import type { Job } from "../../jobs/Job.type.js";
import type { SiteEnergyConfiguration, SiteEnergyInput } from "../../energy/site/SiteEnergy.types.js";
import type { SimulationLogEntry, InputEvent } from "../simulation/clock.js";
import type { ExecutionRun } from "../../reporting/ExecutionEvidence.type.js";
import type { ImpactObservation } from "../../reporting/ImpactObservation.interface.js";
import type { JobReport } from "../../reporting/JobReport.type.js";
import type { TransferTerms } from "../runner/Executor.types.js";
import type { JobRoutingResult } from "../../scheduling/routeAndAcceptJobs.js";

/** Captured, JSON-serializable model inputs with hourly admission.
 * Jobs start queued at home; readyAt and window.startAt are UTC hour boundaries.
 * Captured inputs run a model, never physical equipment or processes. Fleet routing is explicit.
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
        /** Optional declared geography; never inferred from the grid balancing area. */
        name?: string;
        lat?: number;
        lng?: number;
        regionId?: string;
        /** Projections issued by startAt. They never become observations implicitly. */
        forecast: SiteEnergyInput[];
        /** Revealed at the start of their own canonical tick, only if already known. */
        observations: SiteEnergyInput[];
    }[];
    carbonPriceUsdPerTonne: number;
    maximumAgeMinutes: number;
    storageToleranceKWh: number;
    events?: InputEvent[];
    /** Selected arm may move within allowedLocations; baseline remains home FIFO. */
    routing?: { policy: "fleet"; transfer: TransferTerms; movePolicy?: "carbon-benefit" };
    /** Opt-in job-aware soft quotas. Physical ledger limits remain authoritative. */
    planning?: CapacityPlanningPolicy;
};

export type ReplayArm = {
    policy: "home-fifo-immediate-v1" | "home-edf-priced-wait-v1" | "fleet-edf-priced-transfer-v1";
    run: ExecutionRun;
    impact: ImpactObservation;
    decisions: Array<{ hour: number; results: JobRoutingResult[] }>;
    log: SimulationLogEntry[];
    finalJobs: Job[];
    /** Conditional hourly planner witnesses; absent on older scenarios without planning. */
    plans?: HourlyCapacityPlan[];
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
