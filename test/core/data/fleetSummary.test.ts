import { describe, expect, it } from 'vitest';
import { summarizeFleet, type FleetSummaryInput } from '../../../src/ui/fleet/summarizeFleet';
import type { ReplayArm } from '../../../src/core/execution/replay/Replay.types';
import type { SiteMeter } from '../../../src/core/execution/SiteMeter.type';

const horizon = { startAt: '2026-10-28T17:00:00Z', endAt: '2026-10-28T19:00:00Z' };
const firstHour = { startAt: horizon.startAt, endAt: '2026-10-28T18:00:00Z' };
const secondHour = { startAt: firstHour.endAt, endAt: horizon.endAt };
const job = {
  id: 'work-01', workloadRef: 'modeled-batch', computeProfile: 'modeled-gpu', window: horizon,
  allowedLocations: ['A', 'B'], homeLocation: 'A', currentLocation: 'A', readyAt: horizon.startAt,
  workGpuH: 8, remainingGpuH: 8, maxGpus: 4, dataGB: 1, state: 'queued' as const,
};

function meter(locationId: string, stored: number, carbonKg: number | undefined): SiteMeter {
  return {
    locationId, window: firstHour, solarKWh: 6, gridImportKWh: 2, curtailedKWh: 4,
    batteryChargeKWh: 0, batteryDischargeKWh: 0, fixedLoadKWh: 1, computeKWh: 3,
    endingStoredKWh: stored, accountingBasis: 'consumption', carbonKg,
  };
}
function arm(arm: 'baseline' | 'selected'): ReplayArm {
  return {
    policy: arm === 'baseline' ? 'home-fifo-immediate-v1' : 'fleet-edf-priced-transfer-v1',
    run: {
      comparisonId: 'one-model', inputRevision: 'capture-1', arm, jobId: job.id, horizon,
      accountingBasis: 'consumption', source: 'literal model inputs', simulated: true, storageToleranceKWh: 0,
      jobs: [job], sites: [{ locationId: 'A', initialStoredKWh: 1 }, { locationId: 'B', initialStoredKWh: 2 }],
      ticks: [], transfers: [],
    },
    impact: {
      comparisonId: 'one-model', inputRevision: 'capture-1', arm, jobId: job.id, horizon,
      accountingBasis: 'consumption', source: 'literal model inputs', simulated: true, storageToleranceKWh: 0,
      feasible: true, carbonKg: arm === 'baseline' ? 2 : 3,
      work: [{ jobId: job.id, requiredGpuH: 8, completedGpuH: 8 }],
      inventory: [
        { locationId: 'A', initialStoredKWh: 1, endingStoredKWh: 1,
          initialStoredCarbonKg: 0.4, endingStoredCarbonKg: 0.4 },
        { locationId: 'B', initialStoredKWh: 2, endingStoredKWh: 2,
          initialStoredCarbonKg: 0.8, endingStoredCarbonKg: 0.8 },
      ],
    },
    decisions: [], log: [], finalJobs: [job],
  };
}
function progress(): FleetSummaryInput {
  return {
    done: false, selected: arm('selected'), baseline: arm('baseline'),
    scenario: {
      schemaVersion: 1, id: 'one-model', inputRevision: 'capture-1', label: 'Literal example',
      seed: 1, startAt: horizon.startAt, hours: 2, jobs: [job],
      carbonPriceUsdPerTonne: 0, maximumAgeMinutes: 60, storageToleranceKWh: 0,
      sites: ['A', 'B'].map(locationId => ({
        computeProfile: 'modeled-gpu', forecast: [], observations: [],
        configuration: {
          locationId, compute: { capGpus: 4, kWPerGpu: 1 }, accountingBasis: 'consumption',
          storage: {
            initial: { storedKWh: locationId === 'A' ? 1 : 2 },
            limits: { capacityKWh: 5, chargeKW: 1, dischargeKW: 1 },
            efficiency: { charge: 1, discharge: 1 },
          },
        },
      })),
    },
  };
}
function withReceipts(): FleetSummaryInput {
  const input = progress();
  input.selected.run.ticks = [{
    feasible: true,
    meters: [meter('A', 0.5, 1), meter('B', 1.5, 2)],
    executions: [{
      jobId: job.id, locationId: 'A', window: firstHour, completedGpuH: 3, remainingGpuH: 5,
      state: 'running', computeKWh: 3, postedChargeUsd: 0.2,
    }],
  }];
  input.selected.run.transfers = [{
    id: 'transfer-1', jobId: job.id, fromLocation: 'A', toLocation: 'B', window: firstHour,
    energyKWh: 0.1, accountingBasis: 'consumption', carbonKg: 0.25, jobChargeUsd: 0.01,
  }];
  return input;
}

describe('modeled fleet summary', () => {
  it('starts with no energy or carbon receipts and the declared initial battery inventory', () => {
    const summary = summarizeFleet(progress());
    expect(summary.work).toEqual({ completedGpuH: 0, totalGpuH: 8 });
    expect(summary.energy).toEqual({ hasReceipts: false, solarUsedKWh: 0, gridImportKWh: 0 });
    expect(summary.storage).toEqual({ storedKWh: 3, capacityKWh: 10 });
    expect(summary.carbon).toEqual({ status: 'pending', kg: null });
    expect(summary.comparison).toEqual({ status: 'pending', carbonReductionKg: null });
  });

  it('counts settled work, solar retained after curtailment, grid imports and transfer carbon', () => {
    const summary = summarizeFleet(withReceipts());
    expect(summary.work).toEqual({ completedGpuH: 3, totalGpuH: 8 });
    expect(summary.energy).toEqual({ hasReceipts: true, solarUsedKWh: 4, gridImportKWh: 4 });
    expect(summary.storage).toEqual({ storedKWh: 2, capacityKWh: 10 });
    expect(summary.carbon).toEqual({ status: 'known', kg: 3.25 });
    expect(summary.comparison.status).toBe('pending');
  });

  it('uses each site’s latest inventory without adding old battery readings', () => {
    const input = withReceipts();
    input.selected.run.ticks = [...input.selected.run.ticks, {
      feasible: true, executions: [], meters: [{ ...meter('A', 0.25, 0.1), window: secondHour }],
    }];
    expect(summarizeFleet(input).storage.storedKWh).toBe(1.75);
  });

  it('keeps missing site or transfer carbon unknown instead of reporting a partial total', () => {
    const missingSite = withReceipts();
    missingSite.selected.run.ticks[0].meters[0].carbonKg = undefined;
    expect(summarizeFleet(missingSite).carbon).toEqual({ status: 'unknown', kg: null });
    const missingTransfer = withReceipts();
    missingTransfer.selected.run.transfers = [{ ...missingTransfer.selected.run.transfers[0], carbonKg: undefined }];
    expect(summarizeFleet(missingTransfer).carbon).toEqual({ status: 'unknown', kg: null });
  });

  it('preserves a negative final reduction and suppresses unequal-work or unequal-inventory comparisons', () => {
    const input = withReceipts();
    input.done = true;
    expect(summarizeFleet(input).comparison).toEqual({ status: 'comparable', carbonReductionKg: -1 });
    input.selected.impact.work = [{ jobId: job.id, requiredGpuH: 8, completedGpuH: 7 }];
    expect(summarizeFleet(input).comparison).toEqual({ status: 'unavailable', carbonReductionKg: null });
    input.selected.impact.work = [{ jobId: job.id, requiredGpuH: 8, completedGpuH: 8 }];
    input.selected.impact.inventory = [{ locationId: 'A', initialStoredKWh: 1, endingStoredKWh: 0 }, input.selected.impact.inventory[1]];
    expect(summarizeFleet(input).comparison).toEqual({ status: 'unavailable', carbonReductionKg: null });
  });
});
