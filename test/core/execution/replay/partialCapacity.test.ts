import { expect, test } from 'vitest';
import { runPairedReplay } from '../../../../src/core/execution/replay/runPairedReplay';
import { defaultCapacityPlanningPolicy } from '../../../../src/core/energy/planning/CapacityPlan.types';
import { threeHourScenario } from './fixture';

function batteryOnlyWork(workGpuH: number, dischargeKW = 1) {
  const scenario = threeHourScenario();
  scenario.planning = { ...defaultCapacityPlanningPolicy };
  scenario.sites = [scenario.sites[0]];
  Object.assign(scenario.jobs[0], { workGpuH, remainingGpuH: workGpuH,
    window: { startAt: scenario.startAt, endAt: '2026-10-28T19:00:00Z' } });
  const site = scenario.sites[0];
  site.configuration.storage = {
    initial: { storedKWh: 0.5, carbonKg: 0.2, electricityUsd: 0.025 },
    limits: { capacityKWh: 0.5, chargeKW: 0, dischargeKW },
    efficiency: { charge: 1, discharge: 1 },
  };
  for (const input of [...site.observations, ...site.forecast]) {
    input.supply = { solarKW: 0, gridImportLimitKW: 0, fixedLoadKW: 0, protectedKWh: 0 };
  }
  return scenario;
}

test('the planner opens a full-power GPU for a quarter-hour job supported by half a kWh', async () => {
  const result = await runPairedReplay(batteryOnlyWork(0.25));
  expect(result.selected.plans![0].deadlines[0]).toMatchObject({ status: 'covered', plannedGpuH: 0.25 });
  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'done', remainingGpuH: 0 });
  expect(result.selected.run.ticks[0].executions[0].completedGpuH).toBe(0.25);
  expect(result.selected.run.ticks[0].meters[0]).toMatchObject({ computeKWh: 0.25, endingStoredKWh: 0.25 });
});

test('fractional energy does not replace the full active power required by one GPU', async () => {
  const result = await runPairedReplay(batteryOnlyWork(0.25, 0.25));
  expect(result.selected.plans![0].deadlines[0].status).toBe('shortfall');
  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'missed', remainingGpuH: 0.25 });
  expect(result.selected.run.ticks[0].meters[0]).toMatchObject({ computeKWh: 0, endingStoredKWh: 0.5 });
});

test('two jobs cannot spend the same partial-hour battery budget in a shared capacity witness', async () => {
  const scenario = batteryOnlyWork(0.3, 2);
  scenario.sites[0].configuration.compute.capGpus = 2;
  scenario.jobs.push({ ...structuredClone(scenario.jobs[0]), id: 'second' });
  const result = await runPairedReplay(scenario);
  expect(result.selected.plans![0].deadlines.filter(job => job.status === 'covered')).toHaveLength(1);
  expect(result.selected.plans![0].deadlines.reduce((sum, job) => sum + job.plannedGpuH, 0)).toBeCloseTo(0.3);
  expect(result.selected.finalJobs.filter(job => job.state === 'done')).toHaveLength(1);
  expect(result.selected.run.ticks[0].meters[0]).toMatchObject({ computeKWh: 0.3, endingStoredKWh: 0.2 });
});
