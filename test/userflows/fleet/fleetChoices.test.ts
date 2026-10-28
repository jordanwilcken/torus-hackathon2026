import { expect, test } from '@playwright/test';
import { FleetFlow } from './fleet-flow';

test('the fleet distinguishes remaining capacity and home submission from the accepted execution choice', async ({ page }) => {
  const fleet = new FleetFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.expectCapacityAndSubmissionMeaning();
  await fleet.step();
  await fleet.expectJobChoice('work-02', 'Cedar City', 'Cedar City', 'Cedar City');
});

test('a rejected saved replay offers an explicit fresh start while preserving the archived moment', async ({ page }) => {
  const fleet = new FleetFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.step();
  const saved = await fleet.saveFrozenMoment();

  await fleet.openCaptureWithChangedReceipt(saved);
  await fleet.startFreshRunAfterRejectedCapture();
  await fleet.letPlaybackAdvance(7_000);
  expect(await fleet.modelHour()).toBeGreaterThan(0);
  await fleet.expectStoredCaptureUnchanged(saved);
});
