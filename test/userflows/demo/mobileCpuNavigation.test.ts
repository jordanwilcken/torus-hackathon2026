import { expect, test, type Page } from '@playwright/test';
import { FleetFlow } from '../fleet/fleet-flow';

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
