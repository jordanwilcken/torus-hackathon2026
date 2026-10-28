import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import manifest from '../../fixtures/public-grid/manifest.json' with { type: 'json' };
import eiaCapture from '../../fixtures/public-grid/eia.json' with { type: 'json' };
import caisoCapture from '../../fixtures/public-grid/caiso.json' with { type: 'json' };
import { LiveExecutionFlow } from './live-execution-flow';

// These cases share the application's single local worker, so run this file in order.
// Other browser files keep their configured parallelism.
test.describe.configure({ mode: 'default' });

test('[LIVE-01] current public inputs drive a scheduler decision and an actual job result', async ({ page }) => {
  const flow = new LiveExecutionFlow(page);
  await flow.open();
  const requestId = randomUUID();
  const run = await flow.submitIntegerSum({ requestId, values: [1, 2, 3, 4] });

  expect(run.mode).toBe('recorded');
  expect(run.status).toBe('done');
  expect(run.request.workload).toEqual({ kind: 'integer-sum', values: [1, 2, 3, 4] });
  expect(run.request.inputRevisions).toEqual({
    eia: manifest.feeds.eia.revision,
    caiso: manifest.feeds.caiso.revision,
  });
  expect(run.decision.scheduler).toBe('public-input-local-v1');
  expect(run.decision.action).toBe('run');
  expect(run.decision.asOf).toBe(manifest.asOf);
  expect(run.decision.executionLocation).toBe('This computer');
  expect(run.decision.explanation.trim()).not.toBe('');
  expect(run.decision.policy).toEqual(run.request.policy);
  expect(run.decision.inputs.map(input => input.feed).toSorted()).toEqual(['caiso', 'eia']);

  const demand = run.decision.inputs.find(input => input.feed === 'eia')!;
  const price = run.decision.inputs.find(input => input.feed === 'caiso')!;
  // These are the literal source intervals/values in the committed public captures.
  // EIA's reporting lag remains visible; the current CAISO interval can end after asOf.
  expect(demand).toMatchObject({
    revision: manifest.feeds.eia.revision, sourceUrl: manifest.feeds.eia.sourceUrl,
    retrievedAt: eiaCapture.snapshot.retrievedAt, value: 5108, unit: 'MW',
    interval: { startAt: '2026-10-28T09:00:00.000Z', endAt: '2026-10-28T10:00:00.000Z' },
    ageMinutes: 98, accepted: true,
  });
  expect(price).toMatchObject({
    revision: manifest.feeds.caiso.revision, sourceUrl: manifest.feeds.caiso.sourceUrl,
    retrievedAt: caisoCapture.snapshot.retrievedAt, value: 33.4753, unit: 'USD/MWh',
    interval: { startAt: '2026-10-28T11:35:00.000Z', endAt: '2026-10-28T11:40:00.000Z' },
    ageMinutes: 0, accepted: true,
  });
  for (const input of run.decision.inputs) {
    expect(Date.parse(input.retrievedAt)).toBe(Date.parse(manifest.feeds[input.feed].retrievedAt));
    expect(input.maximumAgeMinutes).toBe(run.request.policy.maximumAgeMinutes[input.feed]);
    expect(input.ageMinutes).toBeLessThanOrEqual(input.maximumAgeMinutes);
    const retrievalAgeMinutes = (Date.parse(run.decision.asOf) - Date.parse(input.retrievedAt)) / 60_000;
    expect(retrievalAgeMinutes).toBeGreaterThanOrEqual(0);
    expect(retrievalAgeMinutes).toBeLessThanOrEqual(input.maximumAgeMinutes);
  }

  const decidedAt = Date.parse(run.decision.evaluatedAt);
  expect(Number.isFinite(decidedAt)).toBe(true);
  expect(decidedAt).toBeGreaterThanOrEqual(Date.parse(manifest.asOf));
  expect(run.id).toBe(requestId);
  expect(run.execution.backend).toBe('node-child-process');
  expect(run.execution.location).toBe('This computer');
  expect(run.execution.simulated).toBe(false);
  expect(run.execution.pid).toBeGreaterThan(0);
  expect(run.execution.startedAt).not.toBeNull();
  expect(run.execution.completedAt).not.toBeNull();
  expect(Date.parse(run.execution.startedAt!)).toBeGreaterThanOrEqual(decidedAt);
  expect(Date.parse(run.execution.completedAt!)).toBeGreaterThanOrEqual(Date.parse(run.execution.startedAt!));
  expect(run.execution.exitCode).toBe(0);
  expect(run.execution.error).toBeNull();
  expect(run.execution.events.map(event => event.state)).toEqual(expect.arrayContaining(['running', 'progress', 'done']));
  expect(run.execution.events).toContainEqual(expect.objectContaining({ state: 'progress', completed: 4, total: 4 }));
  const eventTimes = run.execution.events.map(event => Date.parse(event.at));
  expect(eventTimes.every(Number.isFinite)).toBe(true);
  expect(eventTimes).toEqual(eventTimes.toSorted((a, b) => a - b));

  const outputText = await flow.downloadOutput();
  expect(JSON.parse(outputText)).toEqual({ requestId, sum: 10 });
  expect(run.execution.output).not.toBeNull();
  expect(run.execution.output!.text).toBe(outputText);
  expect(run.execution.output!.id).toBe(createHash('sha256').update(outputText).digest('hex'));
  expect(run.execution.output!.contentType).toBe('application/json');
  expect(run.measuredEnergyKWh).toBeNull();
  expect(run.measuredCarbonKg).toBeNull();
  expect(run.actualElectricityCostUsd).toBeNull();

  const model = run.comparison;
  expect(model.modeled).toBe(true);
  expect(model.label).toMatch(/hypothetical.*storage/i);
  expect(model.computeKWh).toBe(run.request.model.computeKWh);
  expect(model.computeKWh).toBeGreaterThan(0);
  expect(model.roundTripEfficiency).toBe(run.request.model.roundTripEfficiency);
  expect(model.roundTripEfficiency).toBeGreaterThan(0);
  expect(model.roundTripEfficiency).toBeLessThan(1);
  expect(model.baselineGridKWh).toBe(model.computeKWh);
  expect(model.storageGridKWh * model.roundTripEfficiency).toBeCloseTo(model.computeKWh, 12);
  expect(model.storageGridKWh).toBeCloseTo(model.computeKWh / model.roundTripEfficiency, 12);
  const baselineReferenceUsd = model.computeKWh * 33.4753 / 1000;
  const storageReferenceUsd = model.computeKWh / model.roundTripEfficiency * 33.4753 / 1000;
  expect(model.baselineReferenceUsd).toBeCloseTo(baselineReferenceUsd, 12);
  expect(model.storageReferenceUsd).toBeCloseTo(storageReferenceUsd, 12);
  expect(model.differenceUsd).toBeCloseTo(baselineReferenceUsd - storageReferenceUsd, 12);
  expect(model.differenceUsd).toBeLessThan(0);
  expect(model.carbonKg).toBeNull();
  expect(model.assumptions.energy).toMatch(/equal assumed compute energy/i);
  expect(model.assumptions.storage).toMatch(/same initial and ending inventory/i);
  expect(model.assumptions.carbon).toMatch(/unknown/i);
  expect(model.assumptions.market).toMatch(/wholesale.*not an actual electricity bill/i);
  await flow.expectEvidenceLabels(run);
});

test('a public-demand limit refuses execution, then a new request runs under a permissive limit', async ({ page }) => {
  const flow = new LiveExecutionFlow(page);
  await flow.open();
  const refused = await flow.submitIntegerSum({ requestId: randomUUID(), values: [1, 2], maximumDemandMW: 0 });

  expect(refused.status).toBe('blocked');
  expect(refused.decision.action).toBe('wait');
  expect(refused.decision.explanation).toMatch(/demand.*exceeds/i);
  expect(refused.decision.inputs.find(input => input.feed === 'eia')).toMatchObject({
    revision: manifest.feeds.eia.revision, value: 5108, accepted: false,
  });
  expect(refused.execution.pid).toBeNull();
  expect(refused.execution.startedAt).toBeNull();
  expect(refused.execution.output).toBeNull();
  expect(refused.execution.events.map(event => event.state)).not.toContain('running');
  expect(await flow.hasOutputArtifact()).toBe(false);

  const requestId = randomUUID();
  const accepted = await flow.submitIntegerSum({ requestId, values: [1, 2], maximumDemandMW: 20_000 });
  expect(accepted.id).not.toBe(refused.id);
  expect(accepted.request.inputRevisions).toEqual(refused.request.inputRevisions);
  expect(accepted.status).toBe('done');
  expect(accepted.decision.action).toBe('run');
  expect(accepted.execution.pid).toBeGreaterThan(0);
  expect(JSON.parse(await flow.downloadOutput())).toEqual({ requestId, sum: 3 });
});

test('an actual worker overflow fails without reusing the previous successful artifact', async ({ page }) => {
  const flow = new LiveExecutionFlow(page);
  await flow.open();
  const previous = await flow.submitIntegerSum({ requestId: randomUUID(), values: [5] });
  expect(previous.status).toBe('done');
  expect(JSON.parse(await flow.downloadOutput())).toEqual({ requestId: previous.id, sum: 5 });

  const failed = await flow.submitIntegerSum({ requestId: randomUUID(), values: [Number.MAX_SAFE_INTEGER, 1] });
  expect(failed.id).not.toBe(previous.id);
  expect(failed.status).toBe('failed');
  expect(failed.decision.action).toBe('run');
  expect(failed.execution.pid).toBeGreaterThan(0);
  expect(failed.execution.exitCode).not.toBeNull();
  expect(failed.execution.exitCode).not.toBe(0);
  expect(failed.execution.error).toMatch(/safe integer/i);
  expect(failed.execution.output).toBeNull();
  expect(failed.execution.events.map(event => event.state)).toContain('running');
  expect(failed.execution.events.map(event => event.state)).not.toContain('done');
  expect(await flow.hasOutputArtifact()).toBe(false);
  expect(failed.measuredEnergyKWh).toBeNull();
});

test('reloading a stored run preserves its receipt and artifact without submitting another job', async ({ page }) => {
  const flow = new LiveExecutionFlow(page);
  await flow.open();
  const requestId = randomUUID();
  const original = await flow.submitIntegerSum({ requestId, values: [7, 8] });
  const originalOutput = await flow.downloadOutput();
  expect(JSON.parse(originalOutput)).toEqual({ requestId, sum: 15 });
  expect(flow.runIdInAddress).toBe(original.id);
  expect(flow.submittedRunCount).toBe(1);

  const restored = await flow.reloadRun(requestId);
  expect(restored).toEqual(original);
  expect(await flow.downloadOutput()).toBe(originalOutput);
  expect(flow.submittedRunCount).toBe(1);
});

test('the grid-summary workload computes its artifact from the pinned public EIA snapshot', async ({ page }) => {
  const flow = new LiveExecutionFlow(page);
  await flow.open();
  const requestId = randomUUID();
  const run = await flow.submitGridSummary({ requestId });

  expect(run.mode).toBe('recorded');
  expect(run.status).toBe('done');
  expect(run.request.workload).toEqual({ kind: 'grid-summary' });
  expect(run.request.inputRevisions).toEqual({
    eia: manifest.feeds.eia.revision,
    caiso: manifest.feeds.caiso.revision,
  });
  expect(run.decision.action).toBe('run');
  expect(run.decision.inputs.find(input => input.feed === 'eia')?.revision).toBe(manifest.feeds.eia.revision);
  expect(run.execution.backend).toBe('node-child-process');
  expect(run.execution.simulated).toBe(false);
  expect(run.execution.pid).toBeGreaterThan(0);
  expect(run.execution.exitCode).toBe(0);

  const outputText = await flow.downloadOutput();
  // Literal totals independently checked against the 72 committed EIA demand observations.
  expect(JSON.parse(outputText)).toEqual({ requestId, count: 72, sum: 398799, min: 4569, max: 6702, mean: 5538.875 });
  expect(run.execution.output).toEqual({
    id: createHash('sha256').update(outputText).digest('hex'),
    text: outputText,
    contentType: 'application/json',
  });
});
