import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1ea"/></svg>',
  }));
});

async function openMap(page: Page) {
  await page.goto('/test/userflows/scheduling/posted-price.html');
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(map).toBeVisible();
  return map;
}

function siteDetails(map: Locator) {
  return map.getByRole('region', { name: 'Price details', exact: true });
}

async function openUtah(page: Page) {
  const map = await openMap(page);
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  return map;
}

async function expectBelowCanvas(map: Locator, details: Locator) {
  const canvas = await map.locator('.map-canvas').boundingBox();
  const panel = await details.boundingBox();
  const mapBounds = await map.boundingBox();
  expect(canvas).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  expect(panel!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(mapBounds!.y + mapBounds!.height + 1);
}

test('[TRANSIENT-01] hovering or focusing a US region reveals only its small name until clicked', async ({ page }) => {
  const map = await openMap(page);
  await map.getByRole('button', { name: 'Show US', exact: true }).click();
  const region = map.getByRole('button', { name: 'Inspect CISO region', exact: true });
  await region.hover();
  await expect(region.locator('strong')).toBeVisible();
  await expect(region.locator('strong')).toHaveText('CISO');
  await expect(map.getByRole('region', { name: 'Regional context', exact: true })).toHaveCount(0);
  await expect(siteDetails(map)).toHaveCount(0);
  await page.getByRole('link', { name: 'Sunchaser', exact: true }).hover();
  await region.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(region).toBeFocused();
  await expect(region.locator('strong')).toBeVisible();
  await expect(map.getByRole('region', { name: 'Regional context', exact: true })).toHaveCount(0);
});

test('[TRANSIENT-02] clicked region and site information stays below the canvas without changing the supplied choice', async ({ page }) => {
  const map = await openMap(page);
  const supplied = await page.evaluate(() => window.pricePreview.read());
  await map.getByRole('button', { name: 'Show US', exact: true }).click();
  await map.getByRole('button', { name: 'Inspect CISO region', exact: true }).click();
  const region = map.getByRole('region', { name: 'Regional context', exact: true });
  await expect(region).toBeVisible();
  await expect(region).toContainText('CISO');
  await expectBelowCanvas(map, region);

  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await map.getByRole('button', { name: 'Inspect Provo', exact: true }).click();
  const site = siteDetails(map);
  await expect(site.getByRole('heading', { level: 3 })).toContainText('Provo');
  await expect(site.getByText('$0.09', { exact: false }).first()).toBeVisible();
  await expectBelowCanvas(map, site);
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Lehi');
  expect(await page.evaluate(() => window.pricePreview.read())).toEqual(supplied);
});

test('[TRANSIENT-03] leaving the map clears clicked information even when the site pin keeps keyboard focus', async ({ page }) => {
  const map = await openUtah(page);
  const pin = map.getByRole('button', { name: 'Inspect Provo', exact: true });
  await pin.click();
  await expect(siteDetails(map)).toBeVisible();
  await expect(pin).toBeFocused();
  await page.getByRole('link', { name: 'Sunchaser', exact: true }).hover();
  await expect(siteDetails(map)).toHaveCount(0);
  await expect(pin).toBeFocused();
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();
});

test('[TRANSIENT-04] actual details focus protects reading from pointer movement, while outside focus or clicking dismisses it', async ({ page }) => {
  const map = await openUtah(page);
  const pin = map.getByRole('button', { name: 'Inspect Provo', exact: true });
  const brand = page.getByRole('link', { name: 'Sunchaser', exact: true });
  await pin.click();
  const summary = siteDetails(map).getByText('Price evidence', { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await brand.hover();
  await expect(summary).toBeFocused();
  await expect(siteDetails(map)).toBeVisible();
  await expect(siteDetails(map).getByText('illustrative-site-ledger', { exact: false }).first()).toBeVisible();
  await page.getByRole('heading', { name: 'Prices ahead', exact: true }).click();
  await expect(siteDetails(map)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();

  await pin.click();
  await siteDetails(map).getByText('Price evidence', { exact: true }).focus();
  await brand.focus();
  await expect(siteDetails(map)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();
});

test('[TRANSIENT-05] blank-map clicks and Escape clear details without clearing the clicked forecast subject', async ({ page }) => {
  const map = await openUtah(page);
  const pin = map.getByRole('button', { name: 'Inspect Provo', exact: true });
  await pin.click();
  await expect(siteDetails(map)).toBeVisible();
  const canvas = map.locator('.map-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.click({ position: { x: 80, y: bounds!.height - 70 } });
  await expect(siteDetails(map)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();

  await pin.click();
  await expect(siteDetails(map)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(siteDetails(map)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();
});

test('[TRANSIENT-06] phone users can read the full-width information below the map and dismiss it by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await openUtah(page);
  await map.getByRole('button', { name: 'Inspect Provo', exact: true }).click();
  const details = siteDetails(map);
  await expect(details).toBeVisible();
  await expectBelowCanvas(map, details);
  const bounds = await details.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await details.getByText('Price evidence', { exact: true }).click();
  await expect(details.getByText('illustrative-carbon-model', { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(map).toBeVisible();
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();
});

test('[TRANSIENT-07] the existing noncompact map retains its regional hover preview', async ({ page }) => {
  await page.goto('/?scenario=fake-preview');
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Show US', exact: true }).click();
  await map.getByRole('button', { name: 'Inspect CISO region', exact: true }).hover();
  const overview = map.getByRole('region', { name: 'Regional overview', exact: true });
  await expect(overview).toBeVisible();
  await expect(overview).toContainText('San Jose, CA');
  const canvas = await map.locator('.map-canvas').boundingBox();
  const panel = await overview.boundingBox();
  expect(canvas).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(panel!.y).toBeLessThan(canvas!.y + canvas!.height);
});

test('[TRANSIENT-08] a native hour click after expanding map evidence still inspects that hour and the next forecast choice', async ({ page }) => {
  const map = await openUtah(page);
  await page.getByRole('region', { name: 'Lehi prices', exact: true })
    .getByRole('button', { name: /^Inspect Lehi, 13:00 UTC,/ }).click();
  await expect(siteDetails(map).getByText('$0.045', { exact: false }).first()).toBeVisible();
  const evidence = siteDetails(map).getByText('Price evidence', { exact: true });
  await evidence.click();
  await expect(evidence).toBeFocused();
  await expect(siteDetails(map).getByText('illustrative-site-ledger', { exact: false }).first()).toBeVisible();

  await page.getByRole('region', { name: 'Provo prices', exact: true })
    .getByRole('button', { name: /^Inspect Provo, 13:00 UTC,/ }).click();
  await expect(siteDetails(map).getByRole('heading', { level: 3 })).toContainText('Provo');
  await expect(siteDetails(map).getByText('$0.065', { exact: false }).first()).toBeVisible();
  await expect(siteDetails(map).getByText('Conditional forecast', { exact: true })).toBeVisible();

  await page.getByRole('region', { name: 'Provo forecast', exact: true })
    .getByRole('button', { name: 'Inspect Provo carbon forecast, 12:00 UTC, 28 Oct 2026', exact: true }).click();
  await expect(siteDetails(map).getByRole('heading', { level: 3 })).toContainText('Provo');
  await expect(siteDetails(map).getByText('$0.09', { exact: false }).first()).toBeVisible();
  await expect(siteDetails(map).getByText('Available now', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Lehi');
});

test('[TRANSIENT-09] clicking a price hour from a pin inspection then a forecast hour keeps both native actions effective', async ({ page }) => {
  const map = await openUtah(page);
  const supplied = await page.evaluate(() => window.pricePreview.read());
  await map.getByRole('button', { name: 'Inspect Provo', exact: true }).click();
  await expect(siteDetails(map).getByText('$0.09', { exact: false }).first()).toBeVisible();

  await page.getByRole('region', { name: 'Lehi prices', exact: true })
    .getByRole('button', { name: /^Inspect Lehi, 13:00 UTC,/ }).click();
  await expect(siteDetails(map).getByRole('heading', { level: 3 })).toContainText('Lehi');
  await expect(siteDetails(map).getByText('$0.045', { exact: false }).first()).toBeVisible();
  await page.getByRole('region', { name: 'Lehi forecast', exact: true })
    .getByRole('button', { name: 'Inspect Lehi carbon forecast, 12:00 UTC, 28 Oct 2026', exact: true }).click();
  await expect(siteDetails(map).getByText('$0.075', { exact: false }).first()).toBeVisible();
  await expect(siteDetails(map).getByText('Available now', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.pricePreview.read())).toEqual(supplied);
});
