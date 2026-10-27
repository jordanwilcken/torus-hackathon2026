import { expect, test } from '@playwright/test';
import { ComputeFlow } from '../compute-flow';

// Enabled RED test: connect the driver to the real application.
// A has no solar/storage; B has 2 kWh solar and 1 kWh storage. Both start empty.
// Grid intensity is 400 gCO2/kWh; the job uses 1 kWh. Fixtures match the acceptance examples.
test('[FLOW-01] inspects hourly offers and selects a site before work executes', async ({ page }) => {
  const flow = new ComputeFlow(page);
  await flow.open();
  await flow.useScenario('curtailed-solar');
  await flow.submitJob({
    name: 'Training batch', workGpuH: 1, maxGpus: 1,
    deadlineHours: 1, allowedLocations: ['A', 'B'], budgetUsd: 10,
  });

  expect((await flow.offeredSites()).sort()).toEqual(['A', 'B']);
  expect(await flow.selectedSite()).toBe('B');
  expect(await flow.completedGpuHours()).toBe(0);
});
