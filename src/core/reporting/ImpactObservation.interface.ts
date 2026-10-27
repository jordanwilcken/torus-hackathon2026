import type { TimeWindow } from "../TimeWindow.type.js";
/** Both arms must share inputRevision, cohort, horizon and accountingBasis. */
export interface ImpactObservation {
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
  /** Optional until available; null/absent must never become zero. Includes transfer effects. */
  electricityUsd?: number | null;
  modeledCostUsd?: number | null;
  /** Shared realized price policy and carbon price; never compare differently priced arms. */
  costBasis?: string;
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
