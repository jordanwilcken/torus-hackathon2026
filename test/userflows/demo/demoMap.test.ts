import { test } from '@playwright/test';
import { DemoMapFlow } from './demo-map-flow';

test('the normal demo keeps US markers small and reveals regional details only on deliberate inspection', async ({ page }) => {
  const flow = new DemoMapFlow(page);
  await flow.open();
  await flow.showUS();
  await flow.expectSmallPins(40);
  await flow.previewRegionName('CISO');
  await flow.inspectRegion('CISO');
  await flow.dismissInspection();
});

test('Utah inspection keeps the compact price summary visible and reveals its evidence without advancing the replay', async ({ page }) => {
  const flow = new DemoMapFlow(page);
  await flow.open();
  await flow.showUtah();
  await flow.expectReplayHour(0, 4);
  await flow.inspectSite('Site A · Salt Lake City reference', 40);
  await flow.expectCollapsedSiteInformation('Site A · Salt Lake City reference');
  await flow.expandSiteInformation();
  await flow.expectReplayHour(0, 4);
  await flow.dismissInspection();
  await flow.expectReplayHour(0, 4);
});

test('a phone keeps modeled job impact outside the map after real replay steps and can still inspect Salt Lake City', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const flow = new DemoMapFlow(page);
  await flow.open();
  await flow.demo.expectModeledReplay();
  await flow.demo.stepReplayTo(1);
  await flow.demo.stepReplayTo(2);
  await flow.closeReplayControls();
  await flow.expectImpactOutsideMap();
  await flow.showUtah();
  await flow.inspectSite('Site A · Salt Lake City reference', 40);
  await flow.expectCollapsedSiteInformation('Site A · Salt Lake City reference');
  await flow.expandSiteInformation();
  await flow.expectReplayHour(2, 4);
  await flow.dismissInspection();
});
