import { expect, test, type Page } from '@playwright/test';
import recordedExecution from '../../../src/core/reporting/fakes/execution.json' with { type: 'json' };
import type { Job } from '../../../src/core/jobs/Job.type';
import type { ExecutionRun } from '../../../src/core/reporting/ExecutionEvidence.type';
import { ComputeFlow } from '../compute-flow';

type RecordedInput = { job: Job; baseline: ExecutionRun; selected: ExecutionRun };

async function suppliedExecution(page: Page, change?: (input: RecordedInput) => void) {
  const input = structuredClone(recordedExecution) as RecordedInput;
  change?.(input);
  await page.route('**/src/core/reporting/fakes/execution.json*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export default ' + JSON.stringify(input) + ';',
  }));
  const flow = new ComputeFlow(page);
  await flow.useScenario('recorded-comparison');
  return flow;
}

test('supplied equal-work records produce comparable carbon and cost reductions in the application', async ({ page }) => {
  const flow = await suppliedExecution(page);
  const report = await flow.impactReport();

  expect(report.comparable).toBe(true);
  expect(report.completedGpuH).toBe(1);
  expect(report.baselineCarbonKg).toBeCloseTo(0.4, 9);
  expect(report.selectedCarbonKg).toBe(0);
  expect(report.reductionKg).toBeCloseTo(0.4, 9);
  expect(report.baselineModeledCostUsd).toBeCloseTo(0.09, 9);
  expect(report.selectedModeledCostUsd).toBe(0);
  expect(report.modeledCostReductionUsd).toBeCloseTo(0.09, 9);
  expect(report.baselineElectricityUsd).toBeCloseTo(0.05, 9);
  expect(report.selectedElectricityUsd).toBe(0);
  const table = page.getByRole('table', { name: 'Observed impact report' });
  await expect(table.getByRole('row', { name: /Carbon/ }).getByRole('cell')).toHaveText(['0.40', '0.00']);
  await expect(table.getByRole('row', { name: /Electricity/ }).getByRole('cell')).toHaveText(['$0.05', '$0.00']);
  await expect(page.getByRole('region', { name: 'Execution evidence', exact: true })).toContainText(/fleet/i);
});

test('worse supplied outcomes remain negative reductions rather than claimed savings', async ({ page }) => {
  const flow = await suppliedExecution(page, input => {
    const meter = input.selected.ticks[0].meters.find(item => item.locationId === 'fake-utah-solar')!;
    meter.carbonKg = 0.6;
    meter.electricityUsd = 0.1;
  });
  const report = await flow.impactReport();

  expect(report.comparable).toBe(true);
  expect(report.selectedCarbonKg).toBeCloseTo(0.6, 9);
  expect(report.selectedModeledCostUsd).toBeCloseTo(0.16, 9);
  expect(report.reductionKg).toBeCloseTo(-0.2, 9);
  expect(report.modeledCostReductionUsd).toBeCloseTo(-0.07, 9);
  expect(report.selectedElectricityUsd).toBeCloseTo(0.1, 9);
});

test('missing carbon evidence stays unknown without erasing known electricity expenditure', async ({ page }) => {
  const flow = await suppliedExecution(page, input => {
    const meter = input.selected.ticks[0].meters.find(item => item.locationId === 'fake-utah-solar')!;
    delete meter.carbonKg;
  });
  const report = await flow.impactReport();

  expect(report.completedGpuH).toBe(1);
  expect(report.selectedCarbonKg).toBeNull();
  expect(report.reductionKg).toBeNull();
  expect(report.selectedModeledCostUsd).toBeNull();
  expect(report.modeledCostReductionUsd).toBeNull();
  expect(report.selectedElectricityUsd).toBe(0);
  const table = page.getByRole('table', { name: 'Observed impact report' });
  await expect(table.getByRole('row', { name: /Carbon/ }).getByRole('cell').nth(1)).toHaveText('Unavailable');
});

test('different ending storage inventories prevent a comparable reduction', async ({ page }) => {
  const flow = await suppliedExecution(page, input => {
    const meter = input.selected.ticks[0].meters.find(item => item.locationId === 'fake-utah-solar')!;
    meter.endingStoredKWh = 0.5;
  });
  const report = await flow.impactReport();

  expect(report.comparable).toBe(false);
  expect(report.reductionKg).toBeNull();
  expect(report.modeledCostReductionUsd).toBeNull();
  await expect(page.getByRole('region', { name: 'Job report', exact: true })).toContainText(/matching initial and ending stored energy/i);
});

test('completed work comes from supplied executions rather than the requested job size', async ({ page }) => {
  const flow = await suppliedExecution(page, input => {
    const execution = input.selected.ticks[0].executions[0];
    execution.completedGpuH = 0.5;
    execution.remainingGpuH = 0.5;
    execution.state = 'paused';
    execution.computeKWh = 0.5;
    const meter = input.selected.ticks[0].meters.find(item => item.locationId === 'fake-utah-solar')!;
    meter.computeKWh = 0.5;
    meter.curtailedKWh = 0.5;
  });
  const report = await flow.impactReport();

  expect(report.completedGpuH).toBe(0.5);
  expect(report.comparable).toBe(false);
  expect(report.reductionKg).toBeNull();
  expect(report.modeledCostReductionUsd).toBeNull();
  await expect(page.getByRole('region', { name: 'Job report', exact: true })).toContainText('Requested work: 1 GPU-hour');
});
