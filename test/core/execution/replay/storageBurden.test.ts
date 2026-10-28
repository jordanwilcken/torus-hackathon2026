import { expect, test } from 'vitest';
import { runPairedReplay } from '../../../../src/core/execution/replay/runPairedReplay';
import { threeHourScenario } from './fixture';

test('waiting cannot claim savings by retaining dirty battery inventory with the same ending kWh', async () => {
  const scenario = threeHourScenario();
  scenario.sites = [scenario.sites[0]];
  const site = scenario.sites[0];
  site.configuration.storage = {
    initial: { storedKWh: 1, carbonKg: 0.4, electricityUsd: 0.05 },
    limits: { capacityKWh: 1, chargeKW: 1, dischargeKW: 1 },
    efficiency: { charge: 1, discharge: 1 },
  };
  for (const inputs of [site.forecast, site.observations]) inputs.forEach((input, hour) => {
    input.supply = { solarKW: hour === 0 ? 0 : 1, fixedLoadKW: 0, gridImportLimitKW: 1, protectedKWh: 0 };
    input.accounting = { solarCarbonGPerKWh: 40, gridCarbonGPerKWh: 400, solarUsdPerMWh: 0, gridUsdPerMWh: 50 };
  });

  const result = await runPairedReplay(scenario);

  expect(result.baseline.impact.work).toEqual([{ jobId: 'training', requiredGpuH: 1, completedGpuH: 1 }]);
  expect(result.selected.impact.work).toEqual(result.baseline.impact.work);
  expect(result.baseline.impact.inventory[0].endingStoredKWh).toBe(1);
  expect(result.selected.impact.inventory[0].endingStoredKWh).toBe(1);
  expect(result.baseline.impact.carbonKg).toBeCloseTo(0.4);
  expect(result.selected.impact.carbonKg).toBeCloseTo(0.04);
  expect(result.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
  expect(result.comparison.carbon.unavailableReason).toContain('stored carbon');
  expect(result.comparison.cost.unavailableReason).toContain('stored');
});
