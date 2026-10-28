export type LocalRunPolicy = {
  maximumDemandMW: number;
  maximumWholesaleUsdPerMWh: number;
  maximumAgeMinutes: { eia: number; caiso: number };
};
export type PublicRunInput = {
  feed: 'eia' | 'caiso'; revision: string; sourceUrl: string; retrievedAt: string;
  interval: { startAt: string; endAt: string }; value: number; unit: 'MW' | 'USD/MWh';
  ageMinutes: number; maximumAgeMinutes: number; accepted: boolean;
};
export type LocalRunDecision = {
  scheduler: 'public-input-local-v1'; evaluatedAt: string; asOf: string;
  action: 'run' | 'wait' | 'unavailable'; executionLocation: 'Application server' | 'This computer' | 'Cloudflare';
  explanation: string; inputs: PublicRunInput[]; policy: LocalRunPolicy;
};
export type StorageModel = {
  modeled: true; label: string;
  assumptions: { energy: string; storage: string; carbon: string; market: string };
  computeKWh: number; roundTripEfficiency: number; baselineGridKWh: number; storageGridKWh: number;
  baselineReferenceUsd: number | null; storageReferenceUsd: number | null; differenceUsd: number | null;
  carbonKg: null;
};
export type LocalRunRequest = {
  requestId: string;
  workload: { kind: 'integer-sum'; values: number[] } | { kind: 'grid-summary' };
  inputRevisions: { eia: string; caiso: string };
  policy: LocalRunPolicy;
  model: { computeKWh: number; roundTripEfficiency: number };
};
export type LocalRun = {
  id: string; request: LocalRunRequest; createdAt: string; updatedAt: string;
  mode: 'live' | 'recorded'; status: 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'interrupted';
  decision: LocalRunDecision; comparison: StorageModel;
  execution: {
    backend: 'node-child-process' | 'cloudflare-durable-object'; location: 'Application server' | 'This computer' | 'Cloudflare'; simulated: false;
    pid: number | null; startedAt: string | null; completedAt: string | null;
    exitCode: number | null; signal: string | null;
    events: Array<{ state: string; at: string; completed?: number; total?: number }>;
    output: { id: string; text: string; contentType: 'application/json' } | null;
    error: string | null;
  };
  measuredEnergyKWh: null; measuredCarbonKg: null; actualElectricityCostUsd: null;
};
