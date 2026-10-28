import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1ea"/><path d="M0 90h256M80 0v256" stroke="#cdd9ce" stroke-width="2"/></svg>',
  }));
});

async function openMapPrices(page: Page) {
  await page.goto('/test/userflows/scheduling/posted-price.html');
  await expect(page.getByRole('region', { name: 'US energy map', exact: true })).toBeVisible();
}

function lehiHour(page: Page, time: string) {
  return page.getByRole('region', { name: 'Lehi prices', exact: true })
    .getByRole('button', { name: new RegExp(`^Inspect Lehi, ${time} UTC,`) });
}

async function inspectPin(page: Page, name: 'Lehi' | 'Provo') {
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await map.getByRole('button', { name: `Inspect ${name}`, exact: true }).click();
  return map.getByRole('region', { name: 'Price details', exact: true });
}

test('[MAP-PRICE-01] keeps prices and the selected job in their geographic context with simulation and execution status explicit', async ({ page }) => {
  await openMapPrices(page);
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Provo prices', exact: true })).toBeVisible();
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(job).toBeVisible();
  await expect(job).toContainText('Lehi');
  await expect(job.getByText('$0.075', { exact: false }).first()).toBeVisible();
  await expect(job).toContainText('Selected · not executed');
  await expect(page.getByText('Simulated preview · selection only', { exact: true })).toBeVisible();
  await expect(map.getByRole('img', { name: /^Job placement:.*execution not started$/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job impact', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Carbon saved|Cost saved|Completed work/i)).toHaveCount(0);
});

test('[MAP-PRICE-02] inspecting a cheaper future hour opens its map details without navigating or changing the current job choice', async ({ page }) => {
  await openMapPrices(page);
  const originalUrl = page.url();
  const supplied = await page.evaluate(() => window.pricePreview.read());
  await lehiHour(page, '13:00').click();
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  const details = map.getByRole('region', { name: 'Price details', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByRole('heading', { level: 3 })).toContainText('Lehi');
  await expect(details.getByText('$0.045', { exact: false }).first()).toBeVisible();
  await expect(details.getByText('Conditional forecast', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job choice', exact: true }).getByText('$0.075', { exact: false }).first()).toBeVisible();
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate(() => window.pricePreview.read())).toEqual(supplied);
});

test('[MAP-PRICE-03] inspecting Provo on the existing map shows its supplied price while retaining the Lehi selection', async ({ page }) => {
  await openMapPrices(page);
  const originalUrl = page.url();
  const details = await inspectPin(page, 'Provo');
  await expect(details).toBeVisible();
  await expect(details.getByRole('heading', { level: 3 })).toContainText('Provo');
  await expect(details.getByText('$0.09', { exact: false }).first()).toBeVisible();
  await expect(details.getByText('Available now', { exact: true })).toBeVisible();
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(job).toContainText('Lehi');
  await expect(job.getByText('$0.075', { exact: false }).first()).toBeVisible();
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
});

test('[MAP-PRICE-04] stale evidence leaves the map usable and removes any claimed current selection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMapPrices(page);
  await page.evaluate(() => window.pricePreview.show('stale'));
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(map).toBeVisible();
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(job).toContainText('Current site evidence is stale. Waiting for a refreshed offer.');
  await expect(job).toContainText('No slot selected');
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true }).getByText('Selected', { exact: true })).toHaveCount(0);
  await expect(map.getByRole('img', { name: /^Assigned job / })).toHaveCount(0);
  await expect(map.getByRole('img', { name: /^Job placement:.*has no selected site$/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('[MAP-PRICE-05] an empty price horizon preserves the map without inventing a price or decision', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMapPrices(page);
  await page.evaluate(() => window.pricePreview.show('empty'));
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(map).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('No decision yet');
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true })).toContainText('No prices supplied.');
  await expect(page.getByRole('region', { name: 'Provo prices', exact: true })).toContainText('No prices supplied.');
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true }).getByRole('button')).toHaveCount(0);
  await expect(map.getByRole('img', { name: /^Assigned job / })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('[MAP-PRICE-06] mobile inspection uses the existing map details card and close control without losing the map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMapPrices(page);
  const details = await inspectPin(page, 'Lehi');
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByText('$0.075', { exact: false }).first()).toBeVisible();
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(map).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Selected · not executed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
