import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { LiveExecutionFlow } from './live-execution-flow';

// Enabled RED business acceptance specification. Real application bindings are
// still missing. The small sum workload is a proposed acceptance fixture; it
// proves actual output independently of modeled GPU-hours or Torus savings.
test('[LIVE-01] current public inputs drive a scheduler decision and an actual job result', async ({ page }) => {
  const flow = new LiveExecutionFlow(page);
  await flow.open();
  const requestId = randomUUID();
  const run = await flow.submitIntegerSum({ requestId, values: [1, 2, 3, 4] });

  expect(run.publicInputs.length).toBeGreaterThan(0);
  const decidedAt = Date.parse(run.decision.at);
  expect(Number.isFinite(decidedAt)).toBe(true);
  for (const input of run.publicInputs) {
    expect(input.id).not.toBe('');
    expect(input.sourceUrl).toMatch(/^https:\/\//);
    expect(input.simulated).toBe(false);
    expect(input.freshness).toBe('current');
    expect(Date.parse(input.observedAt)).toBeLessThanOrEqual(Date.parse(input.retrievedAt));
    expect(Date.parse(input.retrievedAt)).toBeLessThanOrEqual(decidedAt);
    expect(Date.parse(input.validUntil)).toBeGreaterThanOrEqual(decidedAt);
  }
  expect(run.decision.scheduler).toBe('production');
  expect(run.decision.inputIds.toSorted()).toEqual(run.publicInputs.map(input => input.id).toSorted());
  expect(run.decision.selectedLocation).not.toBe('');
  expect(run.decision.explanation).not.toBe('');

  expect(run.worker.requestId).toBe(requestId);
  expect(run.worker.simulated).toBe(false);
  expect(run.worker.states).toEqual(expect.arrayContaining(['running', 'done']));
  expect(Date.parse(run.worker.startedAt)).toBeGreaterThanOrEqual(decidedAt);
  expect(Date.parse(run.worker.completedAt)).toBeGreaterThanOrEqual(Date.parse(run.worker.startedAt));
  expect(run.worker.exitCode).toBe(0);
  expect(run.worker.outputArtifactId).not.toBe('');
  expect(JSON.parse(run.worker.outputText)).toEqual({ requestId, sum: 10 });

  expect(run.torusComparison.modeled).toBe(true);
  expect(run.torusComparison.label).toMatch(/modeled.*Torus|Torus.*modeled/i);
  expect(run.torusComparison.assumptions.energy.trim()).not.toBe('');
  expect(run.torusComparison.assumptions.storage.trim()).not.toBe('');
  expect(run.torusComparison.assumptions.carbon.trim()).not.toBe('');
  expect(run.torusComparison.assumptions.market.trim()).not.toBe('');
});
