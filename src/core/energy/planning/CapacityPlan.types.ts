import type { TimeWindow } from '../../TimeWindow.type.js';
import type { Job } from '../../jobs/Job.type.js';
import type { SlotSnapshot } from '../SlotSnapshot.type.js';

export type CapacityPlanningPolicy = {
  safetyMargin: number;
  maximumSafetyMargin: number;
  maximumChangeGpus: number;
  maximumRampGpus: number;
  backlogHoursThreshold: number;
};

/** Explicit model settings, not learned physical limits. */
export const defaultCapacityPlanningPolicy: CapacityPlanningPolicy = {
  safetyMargin: 0.1, maximumSafetyMargin: 0.5,
  maximumChangeGpus: 2, maximumRampGpus: 2, backlogHoursThreshold: 4,
};

export type PlanningSite = {
  locationId: string;
  computeProfile: string;
  kWhPerGpuHour: number;
  snapshots: readonly SlotSnapshot[];
  /** Carbon of the ledger's assessed offer; a modeled ranking signal, not marginal emissions. */
  preferences: readonly { window: TimeWindow; version: string; carbonGPerKWh: number; source: string }[];
};

export type PlanningReadiness = { jobId: string; locationId: string; readyAt: string };
export type CapacityPlanInput = {
  asOf: string;
  horizon: TimeWindow;
  jobs: readonly Job[];
  sites: readonly PlanningSite[];
  /** Remote sites are ineligible unless their canonical arrival is explicitly supplied. */
  readiness?: readonly PlanningReadiness[];
  maximumAgeMinutes: number;
  forecastErrorFraction: number;
  policy: CapacityPlanningPolicy;
  previous?: HourlyCapacityPlan;
};

export type PlannedCapacitySlot = {
  locationId: string;
  slotId: string;
  computeProfile: string;
  window: TimeWindow;
  kWhPerGpuHour: number;
  physicalFreeGpus: number;
  /** Energy budget is separate from peak GPUs. Optional only for older saved plan evidence. */
  availableEnergyKWh?: number;
  usedGpus: number;
  /** Total soft cap including commitments; never above the current physical cap. */
  capGpus: number;
  conditional: boolean;
  status: 'current' | 'stale' | 'unavailable';
  source: string;
  version?: string;
  observedAt?: string;
  carbonGPerKWh: number | null;
  reason: string;
};

export type DeadlineCoverage = {
  jobId: string;
  requiredGpuH: number;
  plannedGpuH: number;
  deadline: string;
  status: 'covered' | 'shortfall';
  /** A conservative witness, not a command, reservation or promise of future execution. */
  conditional: true;
  locationId?: string;
  allocations: { slotId: string; gpus: number; workGpuH: number }[];
  reason: string;
};

export type HourlyCapacityPlan = {
  asOf: string;
  horizon: TimeWindow;
  mode: 'planned' | 'degraded';
  reasons: string[];
  safetyMargin: number;
  safetyMarginRequestedGpuH: number;
  safetyMarginOpenedGpuH: number;
  /** Null means ready backlog exists but no current usable capacity is known. */
  backlogHours: number | null;
  slots: PlannedCapacitySlot[];
  deadlines: DeadlineCoverage[];
};
