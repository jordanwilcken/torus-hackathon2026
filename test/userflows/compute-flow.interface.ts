export interface JobInput {
  name: string;
  workGpuH: number;
  maxGpus: number;
  deadlineHours: number;
  allowedLocations: string[];
}

export interface ImpactView {
  comparable: boolean;
  baselineCarbonKg: number | null;
  selectedCarbonKg: number | null;
  reductionKg: number | null;
  baselineModeledCostUsd: number | null;
  selectedModeledCostUsd: number | null;
  modeledCostReductionUsd: number | null;
  completedGpuH: number;
}
