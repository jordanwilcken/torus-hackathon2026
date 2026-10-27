export interface JobInput {
  name: string;
  workGpuH: number;
  maxGpus: number;
  deadlineHours: number;
  allowedLocations: string[];
  budgetUsd: number;
}

export interface ImpactView {
  comparable: boolean;
  baselineCarbonKg: number | null;
  selectedCarbonKg: number | null;
  reductionKg: number | null;
  completedGpuH: number;
}
