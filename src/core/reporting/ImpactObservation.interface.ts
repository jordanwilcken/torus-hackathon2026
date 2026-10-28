import type { TimeWindow } from "../TimeWindow.type.js";
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
  electricityUsd?: number | null;
  modeledCostUsd?: number | null;
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
