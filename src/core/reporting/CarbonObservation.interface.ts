import type { TimeWindow } from "../TimeWindow.type.js";
/** Both arms must share inputRevision, cohort, horizon and accountingBasis. */
export interface CarbonObservation {
  comparisonId: string;
  inputRevision: string;
  arm: 'baseline' | 'selected';
  jobId: string;
  horizon: TimeWindow;
  accountingBasis: string;
  source: string;
  simulated: boolean;
  feasible: boolean;
  carbonKg: number | null;
  work: readonly {
    jobId: string;
    requiredGpuH: number;
    completedGpuH: number;
  }[];
  inventory: readonly {
    locationId: string;
    initialStoredKWh: number;
    endingStoredKWh: number;
  }[];
  storageToleranceKWh: number;
}
