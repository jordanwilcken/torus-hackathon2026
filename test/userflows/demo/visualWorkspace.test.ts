import { expect, test } from '@playwright/test';
import { FleetFlow } from '../fleet/fleet-flow';
import { expectWorkspaceNavigation, openWorkspaceTool } from '../workspace-navigation';

test('the primary workspace is one map with useful signals and on-demand tools', async ({ page }) => {
  const fleet = new FleetFlow(page);
  await fleet.open();
  await fleet.pause();
  await expect(page.locator('.leaflet-container:visible')).toHaveCount(1);
  await expect(page.locator('form:visible')).toHaveCount(0);
  await expect(page.locator('table:visible')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Modeled fleet summary', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open-Meteo source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open-Meteo source', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Source details', exact: true })).toContainText('Open-Meteo');
  await expect(page.getByRole('region', { name: 'Source details', exact: true }).getByRole('link', { name: /source/i })).toBeVisible();
  await page.getByRole('button', { name: 'Close source details', exact: true }).click();
  await expectWorkspaceNavigation(page);
  const before = await fleet.evidence();
  await openWorkspaceTool(page, 'Run CPU work');
  const worker = page.getByRole('dialog', { name: 'Run CPU work', exact: true });
  await expect(worker).toBeVisible();
  await expect(worker.getByRole('button', { name: 'Run locally', exact: true })).toBeVisible();
  await expect(worker.getByLabel('Request ID', { exact: true })).toHaveCount(0);
  await expect(worker.locator('input[type=number]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Live regional inputs', exact: true, includeHidden: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(worker).toBeHidden();
  expect((await fleet.evidence()).selected).toEqual(before.selected);
  await openWorkspaceTool(page, 'Compare scheduling');
  await expect(page.getByRole('region', { name: 'Paired replay', exact: true })).toBeVisible();
  await expect(page.locator('.leaflet-container:visible')).toHaveCount(1);
  await page.getByRole('link', { name: 'Live fleet', exact: true }).click();
  expect((await fleet.evidence()).selected).toEqual(before.selected);
  await expect(page.locator('.leaflet-container:visible')).toHaveCount(1);
});

test('a phone keeps the map and source chips within the screen without exposing forms', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fleet = new FleetFlow(page);
  await fleet.open();
  await fleet.pause();
  await expect(page.locator('.leaflet-container:visible')).toHaveCount(1);
  await expect(page.locator('form:visible')).toHaveCount(0);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await expect(page.getByRole('button', { name: 'EIA source', exact: true })).toBeVisible();
});


test('opening the scenario lab directly still gives Fleet a usable first map', async ({ page }) => {
  const fleet = new FleetFlow(page);
  await fleet.open();
  await page.goto('/?scenario=paired-replay');
  await expect(page.getByRole('region', { name: 'Paired replay', exact: true })).toBeVisible();
  await expect(page.locator('.leaflet-container:visible')).toHaveCount(1);
  await page.getByRole('link', { name: 'Live fleet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download model evidence', exact: true })).toBeEnabled();
  await fleet.pause();
  await page.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inspect Salt Lake City', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Inspect Richmond', exact: true })).toBeInViewport();
  await fleet.inspectLocation('Salt Lake City');
  await expect(page.getByRole('region', { name: 'Location activity', exact: true })).toBeVisible();
});
