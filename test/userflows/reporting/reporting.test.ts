import { expect, test } from '@playwright/test';
import { ComputeFlow } from '../compute-flow';

// Enabled RED test: connect the driver to the real application.
// A has no solar/storage; B has 2 kWh solar and 1 kWh storage. Both start empty.
// Grid intensity is 400 gCO2/kWh; the job uses 1 kWh. Fixtures match the acceptance examples.
test('[FLOW-02] executes work and sees a comparable carbon report', async ({ page }) => {
  const flow = new ComputeFlow(page);
  await flow.open();
  await flow.useScenario('curtailed-solar');
  await flow.submitJob({
    name: 'Training batch', workGpuH: 1, maxGpus: 1,
    deadlineHours: 1, allowedLocations: ['A', 'B'], budgetUsd: 10,
  });
  await flow.executeAndCompare();

  const report = await flow.impactReport();
  expect(report.comparable).toBe(true);
  expect(report.completedGpuH).toBe(1);
  expect(report.baselineCarbonKg).toBeCloseTo(0.4, 9);
  expect(report.selectedCarbonKg).toBe(0);
  expect(report.reductionKg).toBeCloseTo(0.4, 9);
});
