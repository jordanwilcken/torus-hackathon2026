import type { Executor } from "../Executor.interface.js";
import type { Job } from "../../jobs/Job.type.js";
import type { SiteEnergyLedger } from "../../energy/site/SiteEnergy.types.js";

/** The profile and accounting basis must describe this ledger's configuration.
 * One runner exclusively settles its supplied ledgers; reads and input/quote updates remain public.
 */
export type ExecutionSite = {
    locationId: string;
    computeProfile: string;
    kWhPerGpuHour: number;
    accountingBasis: string;
    ledger: SiteEnergyLedger;
};

/** Supplied modeled transfer terms; unavailable rates stay unknown, never implicitly free. */
export type TransferTerms = {
    bandwidthGBPerHour: number;
    kWhPerGB: number;
    accountingBasis: string;
    jobChargeUsdPerGB: number;
    carbonGPerKWh?: number;
    electricityUsdPerMWh?: number;
};

export type ExecutorInputs = {
    jobs: readonly Job[];
    sites: readonly ExecutionSite[];
    maximumAgeMinutes: number;
    transferTerms: (from: string, to: string, startsAt: string) => TransferTerms | undefined;
};

export interface ExecutionRunner extends Executor {
    /** A detached authoritative snapshot, including transfer location/readiness and remaining work. */
    job(id: string): Job | undefined;
}
