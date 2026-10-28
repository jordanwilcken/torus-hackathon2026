import { expect, test } from '@playwright/test';
import { FleetFlow } from './fleet-flow';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`a new visitor at ${viewport.width}px can play and freeze a recent CAISO capture after refresh is throttled`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fleet = new FleetFlow(page);
    await fleet.open({ marketRefreshFailed: true });
    await expect(page.getByRole('status').filter({ hasText: 'This run uses the captured CAISO price' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CAISO source', exact: true })).toContainText('Refresh failed');
    await fleet.pause();
    await fleet.step();
    const evidence = await fleet.evidence();
    expect(evidence.hour).toBe(1);
    expect(evidence.selected.run.ticks[0].executions.some(receipt => receipt.completedGpuH > 0)).toBe(true);
    const saved = await fleet.saveFrozenMoment();
    expect(saved.capture.runInputs.caiso).toMatchObject({
      status: 'stale', revision: '7e55fed62e260bfd0cf7d94af18e965ffa2cb27263a632bcda8e4f3ffdb5c70f',
      snapshot: { retrievedAt: '2026-10-28T16:26:18.023Z' },
    });
    await fleet.reloadFrozenMomentWithoutCurrentFeeds(saved.revision, 1);
    await fleet.expectPausedAt(1);
    await expect(page.getByRole('status').filter({ hasText: 'This run uses the captured CAISO price' })).toBeVisible();
  });
}
