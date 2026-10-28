import { expect, test, type Page } from '@playwright/test';
import { FleetFlow } from '../fleet/fleet-flow';
import { LiveExecutionFlow } from '../execution/live-execution-flow';

async function expectNavigationInViewport(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Demo flow', exact: true });
  for (const name of ['Live fleet', 'Run CPU work', 'Compare scheduling']) {
    await expect(navigation.getByRole('link', { name, exact: true })).toBeInViewport();
  }
}

async function expectCpuBelowHeader(page: Page) {
  const header = await page.locator('.workspace-header').boundingBox();
  const cpu = await page.getByRole('dialog', { name: 'Run CPU work', exact: true }).boundingBox();
  expect(header, 'The workspace header remains visible').not.toBeNull();
  expect(cpu, 'The CPU panel is open').not.toBeNull();
  expect(cpu!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe('touch CPU navigation at ' + viewport.width + '×' + viewport.height, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, actionTimeout: 5_000 });

    test('navigation stays usable above CPU work and preserves the form through switching and closing', async ({ page }) => {
      const fleet = new FleetFlow(page);
      await fleet.open();
      await fleet.pause();
      const originalHour = await fleet.modelHour();
      const cpuLink = page.getByRole('link', { name: 'Run CPU work', exact: true });
      const fleetLink = page.getByRole('link', { name: 'Live fleet', exact: true });
      const labLink = page.getByRole('link', { name: 'Compare scheduling', exact: true });
      const cpu = page.getByRole('dialog', { name: 'Run CPU work', exact: true });
      const workload = cpu.getByRole('combobox', { name: 'Workload', exact: true });
      const values = cpu.getByLabel('Integer values', { exact: true });

      await cpuLink.click();
      await expect(cpu).toBeVisible();
      await expectNavigationInViewport(page);
      await expectCpuBelowHeader(page);
      await workload.selectOption('integer-sum');
      await values.fill('12, -4, 19');

      // Switch directly through the header: closing the tool first would hide the regression.
      await fleetLink.click();
      await expect(cpu).toBeHidden();
      await expect(page.getByRole('region', { name: 'Live input fleet', exact: true })).toBeVisible();
      expect(await fleet.modelHour()).toBe(originalHour);
      await cpuLink.click();
      await expect(workload).toHaveValue('integer-sum');
      await expect(values).toHaveValue('12, -4, 19');

      await labLink.click();
      await expect(cpu).toBeHidden();
      await expect(page.getByRole('region', { name: 'Paired replay', exact: true })).toBeVisible();
      await cpuLink.click();
      await expect(workload).toHaveValue('integer-sum');
      await expect(values).toHaveValue('12, -4, 19');

      await cpu.getByText('Public input details', { exact: true }).click();
      const run = cpu.getByRole('button', { name: 'Run locally', exact: true });
      await expect(run).toBeEnabled();
      await run.scrollIntoViewIfNeeded();
      await expect(run).toBeInViewport();
      await expectNavigationInViewport(page);
      await fleetLink.click();
      await expect(cpu).toBeHidden();
      expect(await fleet.modelHour()).toBe(originalHour);

      await cpuLink.click();
      await values.focus();
      await page.keyboard.press('Escape');
      await expect(cpu).toBeHidden();
      await expect(cpuLink).toBeFocused();
      await cpuLink.click();
      await expect(workload).toHaveValue('integer-sum');
      await expect(values).toHaveValue('12, -4, 19');
      await cpu.getByRole('button', { name: 'Close tool', exact: true }).click();
      await expect(cpu).toBeHidden();
      await expect(cpuLink).toBeFocused();
    });
  });
}


async function fleetMarkerPositions(page: Page) {
  return page.getByRole('region', { name: 'Continuous fleet map', exact: true }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLButtonElement>('button[data-site-id]')].map(button => {
      const marker = button.getBoundingClientRect();
      return {
        id: button.dataset.siteId,
        x: Math.round(marker.x - bounds.x), y: Math.round(marker.y - bounds.y),
        inside: marker.left >= bounds.left && marker.right <= bounds.right &&
          marker.top >= bounds.top && marker.bottom <= bounds.bottom,
      };
    });
  });
}

test.describe('a saved CPU URL on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, actionTimeout: 5_000 });

  test('Fleet fits all six sites when first revealed and preserves the chosen camera on later tab changes', async ({ page }) => {
    test.setTimeout(60_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
    const fleet = new FleetFlow(page);
    await fleet.open();
    await fleet.pause();
    await fleet.step();
    const saved = await fleet.saveFrozenMoment();
    await page.getByRole('link', { name: 'Run CPU work', exact: true }).click();
    const worker = page.getByRole('dialog', { name: 'Run CPU work', exact: true });
    await expect(worker.getByRole('button', { name: 'Run locally', exact: true })).toBeEnabled();

    // Produce a saved receipt through the real owned fixture, not a forged URL or response.
    await page.clock.resume();
    const cpu = new LiveExecutionFlow(page);
    const run = await cpu.submitIntegerSum({ values: [12, -4, 19] });
    expect(run.status).toBe('done');
    expect(run.execution.simulated).toBe(false);
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
    await page.goto('/?run=' + encodeURIComponent(run.id) + '&capture=' + saved.revision);
    await expect(worker).toBeVisible();
    await expect(worker.getByTestId('run-status')).toHaveText('done');

    // The saved map must finish mounting while CPU is still the initial visible view.
    await expect.poll(async () => {
      await page.clock.runFor(250);
      return page.locator('#fleet [aria-label="Fleet model hour"]').getAttribute('data-hour', { timeout: 500 }).catch(() => null);
    }).toBe('1');
    await page.getByRole('link', { name: 'Live fleet', exact: true }).click();
    await expect(worker).toBeHidden();
    await expect.poll(async () => (await fleetMarkerPositions(page)).map(({ id, inside }) => ({ id, inside })))
      .toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(id => ({ id, inside: true })));
    const map = page.getByRole('region', { name: 'Continuous fleet map', exact: true });
    await expect(map.getByRole('button', { name: 'Zoom in', exact: true })).toHaveAttribute('aria-disabled', 'false');
    expect(await fleet.modelHour()).toBe(1);

    await fleet.showGeography('Explore Utah');
    const utah = await fleetMarkerPositions(page);
    expect(utah.filter(marker => marker.inside).map(marker => marker.id)).toEqual(['A', 'B']);
    await page.getByRole('link', { name: 'Run CPU work', exact: true }).click();
    await expect(worker).toBeVisible();
    await page.getByRole('link', { name: 'Live fleet', exact: true }).click();
    await expect.poll(() => fleetMarkerPositions(page)).toEqual(utah);
    await page.getByRole('link', { name: 'Compare scheduling', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Paired replay', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Live fleet', exact: true }).click();
    await expect.poll(() => fleetMarkerPositions(page)).toEqual(utah);
    expect(await fleet.modelHour()).toBe(1);
    await fleet.expectPausedAt(1);
    expect(pageErrors, 'Saved-run restoration and map visibility changes must not throw browser errors').toEqual([]);
  });
});
