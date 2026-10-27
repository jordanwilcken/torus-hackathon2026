import { expect, test } from '@playwright/test';
import { ComputeFlow } from '../compute-flow';

// Enabled RED test: connect the driver to the real application.
// A has no solar/storage; B has 2 kWh solar and 1 kWh storage. Both start empty.
// Grid is 400 gCO2/kWh and $50/MWh; modeled carbon is $100/tonne.
// Posted marginal prices are A $0.09/GPU-h, B $0/GPU-h. The job uses 1 kWh.
test('[FLOW-01] inspects posted prices and selects a site before work executes', async ({ page }) => {
  const flow = new ComputeFlow(page);
  await flow.open();
  await flow.useScenario('curtailed-solar');
  await flow.submitJob({
    name: 'Training batch', workGpuH: 1, maxGpus: 1,
    deadlineHours: 1, allowedLocations: ['A', 'B'],
  });

  const prices = await flow.postedPrices();
  expect(prices).toEqual(expect.arrayContaining([
    { site: 'A', usdPerGpuHour: 0.09 },
    { site: 'B', usdPerGpuHour: 0 },
  ]));
  expect(await flow.selectedSite()).toBe('B');
  expect(await flow.completedGpuHours()).toBe(0);
});
