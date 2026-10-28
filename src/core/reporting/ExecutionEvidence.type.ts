import type { Job } from "../jobs/Job.type.js";
import type { TickObservation } from "../execution/TickObservation.type.js";
import type { SiteMeter } from "../execution/SiteMeter.type.js";
import type { JobExecution } from "../execution/JobExecution.type.js";
import type { TransferObservation } from "../execution/TransferObservation.type.js";
import type { ImpactObservation } from "./ImpactObservation.interface.js";

export type ExecutionRun = Pick<ImpactObservation,
    "comparisonId" | "inputRevision" | "arm" | "jobId" | "horizon" |
    "accountingBasis" | "source" | "simulated" | "storageToleranceKWh"
> & {
    jobs: readonly Job[];
    sites: readonly {
        locationId: string;
        initialStoredKWh: number;
        initialStoredCarbonKg?: number | undefined;
        initialStoredElectricityUsd?: number | undefined;
        gridImportLimitKW?: number;
    }[];
    ticks: readonly TickObservation[];
    transfers: readonly TransferObservation[];
    costPolicy?: { basis: string; carbonPriceUsdPerTonne: number };
};

export type ExecutionSummary = {
    scope: "fleet";
    complete: boolean;
    unavailableReason?: string;
    activity: {
        meters: SiteMeter[];
        executions: JobExecution[];
        transfers: TransferObservation[];
    };
    sites: {
        locationId: string;
        solarKWh: number;
        gridImportKWh: number;
        batteryChargeKWh: number;
        batteryDischargeKWh: number;
        curtailedKWh: number;
        fixedLoadKWh: number;
        computeKWh: number;
        peakAverageGridImportKW: number;
        gridImportLimitKW?: number;
        withinGridImportLimit?: boolean;
    }[];
    jobs: {
        jobId: string;
        completedGpuH: number;
        remainingGpuH: number;
        startDelayHours?: number;
        completionObservedAt?: string;
        deadlineMet?: boolean;
    }[];
};
