import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };
import { DemoFlow } from './demo-flow';

// Uses the configured application server, committed original public captures and actual child process.
// The modeled comparison is computed independently by the replay engine, never presented as measured CPU energy.
test('a judge follows public inputs through real CPU output and a separate modeled scheduling comparison', async ({ page }) => {
  test.setTimeout(60_000);
  const demo = new DemoFlow(page);
  await demo.open();
  await demo.visit('Public inputs');
  await demo.expectPublicInputs('5,108 MW', {
    eia: manifest.feeds.eia.sourceUrl,
    caiso: manifest.feeds.caiso.sourceUrl,
  });

  await demo.visit('Run CPU work');
  const run = await demo.analyzePublicDemand();
  const requestId = demo.lastSubmittedRequestId;
  expect(run.mode).toBe('recorded');
  expect(run.status).toBe('done');
  expect(run.request.workload).toEqual({ kind: 'grid-summary' });
  expect(run.request.inputRevisions).toEqual({
    eia: manifest.feeds.eia.revision,
    caiso: manifest.feeds.caiso.revision,
  });
  expect(run.decision.action).toBe('run');
  expect(run.decision.asOf).toBe(manifest.asOf);
  expect(run.decision.inputs).toEqual(expect.arrayContaining([
    expect.objectContaining({ feed: 'eia', revision: manifest.feeds.eia.revision,
      retrievedAt: new Date(manifest.feeds.eia.retrievedAt).toISOString(), value: 5108, unit: 'MW', accepted: true }),
    expect.objectContaining({ feed: 'caiso', revision: manifest.feeds.caiso.revision,
      retrievedAt: manifest.feeds.caiso.retrievedAt, value: 33.4753, unit: 'USD/MWh', accepted: true }),
  ]));
  expect(run.execution.backend).toBe('node-child-process');
  expect(run.execution.simulated).toBe(false);
  expect(run.execution.pid).toBeGreaterThan(0);
  expect(run.execution.exitCode).toBe(0);
  expect(run.execution.error).toBeNull();
  expect(run.execution.events).toContainEqual(expect.objectContaining({ state: 'progress', completed: 72, total: 72 }));
  expect(run.measuredEnergyKWh).toBeNull();
  expect(run.measuredCarbonKg).toBeNull();
  expect(run.actualElectricityCostUsd).toBeNull();
  expect(run.comparison.modeled).toBe(true);
  await demo.expectExecutionLabels();

  const output = await demo.downloadCpuOutput();
  // These literal totals were independently checked against the 72 committed EIA demand observations.
  expect(JSON.parse(output)).toEqual({ requestId, count: 72, sum: 398799, mean: 5538.875, min: 4569, max: 6702 });
  expect(run.execution.output).toEqual({
    id: createHash('sha256').update(output).digest('hex'),
    text: output, contentType: 'application/json',
  });
  expect(demo.runIdInAddress).toBe(requestId);
  expect(demo.submittedRunCount).toBe(1);

  await demo.visit('Compare scheduling');
  await demo.expectModeledReplay();
  await demo.stepReplayTo(1);
  await demo.expectJobState('job-01', 'Waiting');
  await demo.expectJobState('job-02', 'Upcoming');
  await demo.inspectPublishedHour('Site A', '19:00', '2026-10-28T18:00:00.000Z');
  await demo.finishReplay();
  const comparison = await demo.downloadReplayEvidence();
  expect(comparison.scope).toBe('modeled-fleet');
  expect(comparison.comparison.comparison).toBe('comparable');
  const completedJobs = [
    { jobId: 'job-01', requiredGpuH: 1, completedGpuH: 1 },
    { jobId: 'job-02', requiredGpuH: 1, completedGpuH: 1 },
    { jobId: 'job-03', requiredGpuH: 1, completedGpuH: 1 },
  ];
  expect(comparison.baseline.impact.work).toEqual(completedJobs);
  expect(comparison.selected.impact.work).toEqual(completedJobs);
  expect(comparison.baseline.impact.inventory).toEqual(comparison.selected.impact.inventory);
  expect(comparison.baseline.run.simulated).toBe(true);
  expect(comparison.selected.run.simulated).toBe(true);
  expect(comparison.baseline.run.ticks.flatMap(tick => tick.meters)).toHaveLength(8);
  expect(comparison.selected.run.ticks.flatMap(tick => tick.meters)).toHaveLength(8);
  expect(comparison.selected.finalJobs.map(job => job.state)).toEqual(['done', 'done', 'done']);
  expect(comparison.selected.decisions[0].results[0].selection).toMatchObject({
    selected: false, explanation: expect.stringContaining('Waiting'),
  });

  // Navigation keeps the actual receipt mounted; refreshing its saved URL must not execute it again.
  await demo.visit('Run CPU work');
  expect(await demo.currentReceipt()).toEqual(run);
  expect(demo.runIdInAddress).toBe(requestId);
  expect(demo.submittedRunCount).toBe(1);
  expect(await demo.reloadSavedRun(requestId)).toEqual(run);
  expect(await demo.downloadCpuOutput()).toBe(output);
  expect(demo.submittedRunCount).toBe(1);
});


test('the solar scenario waits one hour and shows savings only after the same modeled work finishes', async ({ page }) => {
  const demo = new DemoFlow(page);
  await demo.open();
  await demo.visit('Compare scheduling');
  await demo.chooseModeledScenario('Wait for solar');
  await demo.expectModeledReplay();
  await demo.stepReplayTo(1, 3);
  await demo.expectJobState('training', 'Waiting');
  await demo.finishReplay(3, 1);

  const evidence = await demo.downloadReplayEvidence();
  expect(evidence.comparison.comparison).toBe('comparable');
  expect(evidence.baseline.impact.work).toEqual([{ jobId: 'training', requiredGpuH: 1, completedGpuH: 1 }]);
  expect(evidence.selected.impact.work).toEqual([{ jobId: 'training', requiredGpuH: 1, completedGpuH: 1 }]);
  expect(evidence.baseline.impact.carbonKg).toBeCloseTo(0.52, 12);
  expect(evidence.selected.impact.carbonKg).toBeCloseTo(0.12, 12);
  expect(evidence.baseline.impact.modeledCostUsd).toBeCloseTo(0.117, 12);
  expect(evidence.selected.impact.modeledCostUsd).toBeCloseTo(0.027, 12);
  expect(evidence.baseline.impact.inventory).toEqual([
    { locationId: 'A', initialStoredKWh: 0, endingStoredKWh: 0 },
    { locationId: 'B', initialStoredKWh: 0, endingStoredKWh: 0 },
  ]);
  expect(evidence.selected.impact.inventory).toEqual(evidence.baseline.impact.inventory);
  expect(await demo.displayedReductions()).toEqual({ carbonKg: 0.4, modeledCostUsd: 0.09 });
});

test('a missed solar forecast keeps the worse realized model result visible', async ({ page }) => {
  const demo = new DemoFlow(page);
  await demo.open();
  await demo.visit('Compare scheduling');
  await demo.chooseModeledScenario('Forecast miss');
  await demo.expectModeledReplay();
  await demo.finishReplay(3, 1);

  const evidence = await demo.downloadReplayEvidence();
  expect(evidence.comparison.comparison).toBe('comparable');
  expect(evidence.scenario.sites[0].forecast[1].supply?.solarKW).toBe(1);
  expect(evidence.scenario.sites[0].forecast[1].evidence.projected).toBe(true);
  expect(evidence.scenario.sites[0].observations[1].supply?.solarKW).toBe(0);
  expect(evidence.scenario.sites[0].observations[1].accounting).toMatchObject({
    gridCarbonGPerKWh: 600, gridUsdPerMWh: 100,
  });
  expect(evidence.baseline.impact.work).toEqual([{ jobId: 'training', requiredGpuH: 1, completedGpuH: 1 }]);
  expect(evidence.selected.impact.work).toEqual(evidence.baseline.impact.work);
  expect(evidence.selected.impact.carbonKg).toBeCloseTo(0.72, 12);
  expect(evidence.selected.run.ticks[1].meters.find(site => site.locationId === 'A')?.gridImportKWh).toBe(1);
  expect(evidence.reductions.carbonKg).toBeCloseTo(-0.2, 12);
  expect(evidence.reductions.modeledCostUsd).toBeCloseTo(-0.07, 12);
  expect(await demo.displayedReductions()).toEqual({ carbonKg: -0.2, modeledCostUsd: -0.07 });
});
