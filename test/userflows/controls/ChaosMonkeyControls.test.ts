import { expect, test, type Page } from '@playwright/test';

const fixtureUrl = '/test/userflows/controls/fixture.html';
const tileRequests = /^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//;

test.beforeEach(async ({ page }) => {
  await page.route(tileRequests, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/></svg>',
  }));
  await page.goto(fixtureUrl);
  await expect(page.getByRole('region', { name: 'US energy map', exact: true })).toBeVisible();
});

async function openControls(page: Page) {
  await page.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chaos monkey', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the compact map-corner trigger names itself on hover and keyboard focus', async ({ page }) => {
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  const trigger = map.getByRole('button', { name: 'Chaos monkey', exact: true });
  await expect(trigger).toHaveAttribute('title', 'Chaos monkey');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog', { name: 'Chaos monkey', exact: true })).toBeHidden();

  const bounds = await map.boundingBox();
  const button = await trigger.boundingBox();
  expect(bounds).not.toBeNull();
  expect(button).not.toBeNull();
  expect(button!.width).toBeLessThanOrEqual(56);
  expect(button!.height).toBeLessThanOrEqual(56);
  expect(button!.x).toBeGreaterThan(bounds!.x + bounds!.width / 2);
  expect(button!.y).toBeGreaterThan(bounds!.y + bounds!.height / 2);
  expect(button!.x + button!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(button!.y + button!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);

  await trigger.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Chaos monkey');
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.mouse.move(0, 0);
  await trigger.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Chaos monkey');
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test('opening the popup exposes the existing controls and a supplied Step response', async ({ page }) => {
  const dialog = await openControls(page);
  await expect(page.getByRole('button', { name: 'Chaos monkey', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const controls = dialog.getByRole('region', { name: 'Simulation controls', exact: true });
  await expect(controls.getByLabel('Simulation hour', { exact: true })).toHaveText('0 / 24');
  await controls.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(controls.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
  await expect(controls.getByRole('status').filter({ hasText: 'Advanced to hour 1.' })).toBeVisible();
});

test('Escape and Close dismiss the popup, restore trigger focus and preserve supplied progress', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Chaos monkey', exact: true });
  let dialog = await openControls(page);
  await dialog.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
  await dialog.getByRole('button', { name: 'Step', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  dialog = await openControls(page);
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
  await dialog.getByRole('button', { name: 'Close chaos monkey', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('popup commands and scrolling leave the map view stable while map navigation still works', async ({ page }) => {
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  const pane = map.locator('.leaflet-map-pane');
  await expect(pane).toHaveCount(1);
  const initialTransform = await pane.evaluate(element => (element as HTMLElement).style.transform);
  const dialog = await openControls(page);
  await dialog.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
  await dialog.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('2');
  await dialog.hover();
  await page.mouse.wheel(0, 500);
  await dialog.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('2 / 24');
  expect(await pane.evaluate(element => (element as HTMLElement).style.transform)).toBe(initialTransform);

  await dialog.getByRole('button', { name: 'Close chaos monkey', exact: true }).click();
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await expect(map.getByRole('button', { name: 'Explore Utah', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByRole('button', { name: 'Inspect Utah solar example', exact: true })).toBeVisible();
});

test('closing and reopening the popup preserves its pending command guard', async ({ page }) => {
  const dialog = await openControls(page);
  await page.evaluate(() => window.playbackFixture.holdNextStep());
  await dialog.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close chaos monkey', exact: true }).click();
  await openControls(page);
  await expect(dialog.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.playbackFixture.calls())).toEqual([{ action: 'step' }]);
  await page.evaluate(() => window.playbackFixture.releaseStep());
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
  await expect(dialog.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
});

test('a narrow map keeps the popup in bounds and lets its scenario controls scroll into view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await map.scrollIntoViewIfNeeded();
  const dialog = await openControls(page);
  const mapBounds = await map.boundingBox();
  const panel = await dialog.boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(mapBounds!.x);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(mapBounds!.x + mapBounds!.width);
  expect(panel!.y).toBeGreaterThanOrEqual(mapBounds!.y);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(mapBounds!.y + mapBounds!.height);
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(844);

  const scenario = dialog.getByRole('combobox', { name: 'Scenario event', exact: true });
  await scenario.scrollIntoViewIfNeeded();
  await scenario.selectOption('reserve-change');
  const apply = dialog.getByRole('button', { name: 'Apply event', exact: true });
  await apply.scrollIntoViewIfNeeded();
  await apply.click();
  const response = dialog.getByRole('status').filter({ hasText: 'Accepted event reserve-change for hour 2.' });
  await response.scrollIntoViewIfNeeded();
  await expect(response).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('a map consumer without optional controls renders no chaos trigger', async ({ page }) => {
  await page.goto(fixtureUrl + '?view=map-only');
  await expect(page.getByRole('region', { name: 'US energy map', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chaos monkey', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Chaos monkey', exact: true })).toHaveCount(0);
});
