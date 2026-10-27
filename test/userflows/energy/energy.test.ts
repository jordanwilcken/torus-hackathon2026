import { expect, test } from '@playwright/test';
import { ComputeFlow } from '../compute-flow';

// Enabled RED test: connect the driver to the real application.
// At 12:06, A was observed at 12:00 and B at 12:05; max age is 5 minutes.
test('[FLOW-03] distinguishes stale site evidence from a current recommendation', async ({ page }) => {
  const flow = new ComputeFlow(page);
  await flow.open();
  await flow.useScenario('stale-site');

  expect(await flow.siteFreshness('A')).toBe('stale');
  expect(await flow.recommendedNow('A')).toBe(false);
  expect(await flow.siteFreshness('B')).toBe('current');
  expect(await flow.recommendedNow('B')).toBe(true);
});
