import type { Page } from '@playwright/test';
import { ComputeFlow } from '../compute-flow';

/**
 * Proposed acceptance observations, not a new production worker API.
 * Bind this driver to the application's public-input, scheduler and real worker
 * path. Read the worker's output artifact; never calculate it here, fabricate
 * execution records, or launch a separate worker that bypasses the application.
 * The EIA collector is only one input component and cannot satisfy this contract.
 */
export type LiveRun = {
  publicInputs: Array<{
    id: string;
    sourceUrl: string;
    observedAt: string;
    retrievedAt: string;
    validUntil: string;
    freshness: 'current' | 'stale' | 'unavailable';
    simulated: boolean;
  }>;
  decision: {
    at: string;
    scheduler: 'production' | 'fake';
    inputIds: string[];
    selectedLocation: string;
    explanation: string;
  };
  worker: {
    requestId: string;
    simulated: boolean;
    states: string[];
    startedAt: string;
    completedAt: string;
    exitCode: number;
    outputArtifactId: string;
    outputText: string;
  };
  torusComparison: {
    label: string;
    modeled: boolean;
    assumptions: { energy: string; storage: string; carbon: string; market: string };
  };
};

export class LiveExecutionFlow {
  private readonly app: ComputeFlow;

  constructor(page: Page) {
    this.app = new ComputeFlow(page);
  }

  async open(): Promise<void> {
    await this.app.open();
  }

  async submitIntegerSum(_job: { requestId: string; values: number[] }): Promise<LiveRun> {
    throw new Error('Unimplemented LIVE-01: bind current public inputs, the genuine scheduler decision, '
      + 'an actual application worker and its output artifact, and the separately modeled Torus comparison. '
      + 'EIA collection alone is not real job execution.');
  }
}
