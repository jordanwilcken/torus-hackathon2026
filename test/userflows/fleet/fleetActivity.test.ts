import { expect, test } from '@playwright/test';
import { FleetActivityFlow } from './fleet-activity-flow';

test.use({ actionTimeout: 5_000 });

test('nearby arrivals keep separate readable tags on a compact desktop map', async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 850 });
  const fleet = new FleetActivityFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.startNextHour();
  await fleet.expectSubmission('work-01', 'Meta Eagle Mountain, Utah', 'Salt Lake City');
  await fleet.expectLabelsDoNotOverlap();
});

test('empty space around a site marker stays map space while the painted symbol is clickable', async ({ page }) => {
  const fleet = new FleetActivityFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.showGeography('Explore Utah');
  await fleet.expectEmptyMarkerMarginToStayMapSpace();
  await fleet.inspectPaintedSaltLake();
});

test('one paused Step automatically marks Meta to Salt Lake, leaves the painted site clickable, and shows the tag for four seconds', async ({ page }) => {
  const fleet = new FleetActivityFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.setPlaybackSpeed(1);
  await fleet.showGeography('Explore Utah');
  await fleet.startNextHour();
  await fleet.expectSubmission('work-01', 'Meta Eagle Mountain, Utah', 'Salt Lake City');
  await fleet.expectFeedbackPassesPointersThrough();
  await fleet.inspectPaintedSaltLake();
  await fleet.letPlaybackAdvance(3_999);
  await fleet.expectSubmissionTagVisible('work-01');
  expect(await fleet.modelHour()).toBe(1);
  await fleet.letPlaybackAdvance(1);
  await fleet.expectSubmissionExpired('work-01');
  expect(await fleet.modelHour()).toBe(1);
});

test('four-times playback keeps the same four-second readable provenance lifetime', async ({ page }) => {
  const fleet = new FleetActivityFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.setPlaybackSpeed(4);
  await fleet.showGeography('Explore Utah');
  await fleet.startNextHour();
  await fleet.expectSubmission('work-01', 'Meta Eagle Mountain, Utah', 'Salt Lake City');
  await fleet.letPlaybackAdvance(3_999);
  await fleet.expectSubmissionTagVisible('work-01');
  expect(await fleet.modelHour()).toBe(1);
  await fleet.letPlaybackAdvance(1);
  await fleet.expectSubmissionExpired('work-01');
});

test('reduced motion retains static source and destination markers plus provenance without a comet', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fleet = new FleetActivityFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.showGeography('Explore Utah');
  await fleet.startNextHour();
  await fleet.expectSubmission('work-01', 'Meta Eagle Mountain, Utah', 'Salt Lake City');
  await fleet.expectStaticFeedback('work-01');
  await fleet.expectFeedbackPassesPointersThrough();
  await fleet.inspectPaintedSaltLake();
  await fleet.letPlaybackAdvance(3_999);
  await fleet.expectSubmissionTagVisible('work-01');
  await fleet.letPlaybackAdvance(1);
  await fleet.expectSubmissionExpired('work-01');
});

test('restoring hour one keeps old events quiet, the next Step marks new arrivals, and Reset clears feedback at the saved baseline', async ({ page }) => {
  const fleet = new FleetActivityFlow(page);
  await fleet.open();
  await fleet.pause();
  await fleet.step();
  const baseline = await fleet.evidence();
  expect(baseline.hour).toBe(1);
  const saved = await fleet.saveFrozenMoment();
  await fleet.restoreFrozenMoment(saved.revision, 1);
  await fleet.expectNoEventFeedback();
  expect(await fleet.evidence()).toEqual(baseline);

  await fleet.showGeography('Show US');
  await fleet.startNextHour();
  // The real capture declares two jobs/hour; work-03 has home C and its catalog origin is Loudoun.
  await fleet.expectSubmission('work-03', 'Google Loudoun County, Virginia', 'Sacramento');
  await fleet.expectLabelsDoNotOverlap();
  await fleet.letPlaybackAdvance(2_000);
  expect(await fleet.modelHour()).toBe(2);
  await fleet.resetToCaptured(1);
  await fleet.expectNoEventFeedback();
  expect(await fleet.evidence()).toEqual(baseline);
});
