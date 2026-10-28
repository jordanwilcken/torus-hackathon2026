import { expect, test, type Locator, type Page } from '@playwright/test';

type PreviewState = 'selected' | 'waiting' | 'stale' | 'unknown' | 'revised' | 'empty' | 'no-estimate' | 'zero' | 'tiny' | 'overnight';
type PreviewControl = { show(state: PreviewState): void; read(): unknown };
declare global { interface Window { pricePreview: PreviewControl } }

async function openPrices(page: Page) {
  await page.goto('/test/userflows/scheduling/posted-price.html');
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Provo prices', exact: true })).toBeVisible();
}

function lehiHour(page: Page, time: string) {
  return page.getByRole('region', { name: 'Lehi prices', exact: true })
    .getByRole('button', { name: new RegExp(`^Inspect Lehi, ${time} UTC,`) });
}

function disclosure(page: Page, region: Locator, label: string) {
  return region.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${label}$`) }) });
}

async function show(page: Page, state: PreviewState) {
  await page.evaluate(state => window.pricePreview.show(state), state);
}

async function suppliedInputs(page: Page) {
  return page.evaluate(() => window.pricePreview.read());
}

test('[PRICE-01] presents two compact site strips with clear units, availability and collapsed supporting details', async ({ page }) => {
  await openPrices(page);
  const lehi = page.getByRole('region', { name: 'Lehi prices', exact: true });
  const provo = page.getByRole('region', { name: 'Provo prices', exact: true });
  await expect(lehiHour(page, '12:00')).toHaveAccessibleName(/\$0\.075.*Available now/);
  await expect(provo.getByRole('button', { name: /^Inspect Provo, 12:00 UTC,/ })).toHaveAccessibleName(/\$0\.09(?:0)?/);
  await expect(page.getByText('UTC · USD / GPU-hour', { exact: true })).toBeVisible();
  await expect(lehiHour(page, '13:00')).toHaveAccessibleName(/\$0\.045.*Conditional/);
  await expect(lehiHour(page, '14:00')).toHaveAccessibleName(/Sold out/);
  await expect(lehiHour(page, '15:00')).toHaveAccessibleName(/Unavailable/);
  await expect(page.getByText('Simulated preview · selection only', { exact: true })).toBeVisible();
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(disclosure(page, details, 'Price evidence')).toHaveJSProperty('open', false);
  await expect(disclosure(page, job, 'Decision history')).toHaveJSProperty('open', false);
});

test('[PRICE-02] inspects a supplied rate and reveals its source, revision and dated forecast evidence on demand', async ({ page }) => {
  await openPrices(page);
  await lehiHour(page, '12:00').click();
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  await expect(details).toContainText('$0.075');
  await expect(details).toContainText(/Available now/);
  const evidence = disclosure(page, details, 'Price evidence');
  await expect(evidence).toHaveJSProperty('open', false);
  await evidence.locator('summary').click();
  await expect(evidence).toHaveJSProperty('open', true);
  await expect(evidence).toContainText('illustrative-site-ledger');
  await expect(evidence).toContainText('lehi-v1');
  await expect(evidence).toContainText('illustrative-carbon-model');
  await expect(evidence).toContainText('PACE');
  await expect(evidence).toContainText('Operational CO2');
  await expect(evidence).toContainText('300');
  await expect(evidence).toContainText('gCO2/kWh');
  for (const timestamp of [
    '2026-10-28T12:00:00Z',
    '2026-10-28T11:00:00Z',
    '2026-10-28T11:05:00Z',
    '2026-10-28T13:00:00Z',
  ]) await expect(evidence.locator(`time[datetime="${timestamp}"]`).first()).toBeVisible();
  await expect(evidence).toContainText('$0.045');
  await expect(evidence).toContainText(/\$0\.03(?:0)?/);
  await page.getByRole('region', { name: 'Provo prices', exact: true })
    .getByRole('button', { name: /^Inspect Provo, 12:00 UTC,/ }).click();
  const provoEvidence = disclosure(page, details, 'Price evidence');
  if (!(await provoEvidence.evaluate((element: HTMLDetailsElement) => element.open))) await provoEvidence.locator('summary').click();
  await expect(details).toContainText(/\$0\.09(?:0)?/);
  await expect(provoEvidence).not.toContainText(/Energy charge|Carbon charge/);
});

test('[PRICE-03] shows the supplied partial allocation as a selection requiring execution', async ({ page }) => {
  await openPrices(page);
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(job).toContainText(/Selected/);
  await expect(job).toContainText('Lehi has the lower eligible current price and enough capacity before the deadline.');
  await expect(job).toContainText(/1 GPU/);
  await expect(job).toContainText(/0\.25 kWh/);
  await expect(job).toContainText(/Estimated|estimate/);
  await expect(job).toContainText(/not executed|requires acceptance|execution pending/i);
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Provo prices', exact: true }).getByText('Selected', { exact: true })).toHaveCount(0);
});

test('[PRICE-04] supports keyboard inspection and disclosure without mutating supplied slots or selecting another job location', async ({ page }) => {
  await openPrices(page);
  const original = await suppliedInputs(page);
  const laterHour = lehiHour(page, '13:00');
  await laterHour.focus();
  await expect(laterHour).toBeFocused();
  await page.keyboard.press('Enter');
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  await expect(details).toContainText('$0.045');
  await expect(details).toContainText(/Conditional/);
  const summary = disclosure(page, details, 'Price evidence').locator('summary');
  await summary.focus();
  await page.keyboard.press('Space');
  await expect(disclosure(page, details, 'Price evidence')).toHaveJSProperty('open', true);
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();
  expect(await suppliedInputs(page)).toEqual(original);
});

test('[PRICE-05] explains a supplied wait and reveals retained decision history only when requested', async ({ page }) => {
  await openPrices(page);
  await show(page, 'waiting');
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(job).toContainText(/Waiting/);
  await expect(job).toContainText('Waiting for the eligible 13:00 window; no current allocation selected.');
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true }).getByText('Selected', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Provo prices', exact: true }).getByText('Selected', { exact: true })).toHaveCount(0);
  const history = disclosure(page, job, 'Decision history');
  await expect(history).toHaveJSProperty('open', false);
  await expect(history.getByText('Waited for Lehi capacity to become available.', { exact: true })).toBeHidden();
  await history.locator('summary').click();
  await expect(history).toHaveJSProperty('open', true);
  await expect(history).toContainText(/12:00/);
  await expect(history).toContainText('Waited for Lehi capacity to become available.');
  await expect(history).toContainText('Lehi has the lower eligible current price and enough capacity before the deadline.');
});

test('[PRICE-06] keeps stale, unknown and empty inputs explicit while unavailable hours remain inspectable', async ({ page }) => {
  await openPrices(page);
  await show(page, 'stale');
  await expect(lehiHour(page, '12:00')).toBeEnabled();
  await lehiHour(page, '12:00').click();
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  await expect(details).toContainText(/Stale/);
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true }).getByText('Selected', { exact: true })).toHaveCount(0);
  await show(page, 'unknown');
  await expect(lehiHour(page, '12:00')).toBeEnabled();
  await lehiHour(page, '12:00').click();
  await expect(details).toContainText(/Unavailable|Unknown/);
  await expect(details).not.toContainText(/\$0(?:\.0+)?(?:\s|\/|$)/);
  await show(page, 'empty');
  await expect(page.getByText(/No price slots|No supplied slots|No slots|No prices supplied/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Inspect / })).toHaveCount(0);
});

test('[PRICE-07] a changed slot revision removes the current selection marker and preserves its earlier decision', async ({ page }) => {
  await openPrices(page);
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();
  await show(page, 'revised');
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toHaveCount(0);
  const history = disclosure(page, page.getByRole('region', { name: 'Job choice', exact: true }), 'Decision history');
  await history.locator('summary').click();
  await expect(history).toContainText(/12:00/);
  await expect(history).toContainText('Lehi has the lower eligible current price and enough capacity before the deadline.');
});

test('[PRICE-08] fits mobile while preserving hour inspection and optional evidence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPrices(page);
  const unavailableHour = lehiHour(page, '15:00');
  await unavailableHour.scrollIntoViewIfNeeded();
  await expect(unavailableHour).toBeEnabled();
  await unavailableHour.click();
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  await expect(details).toContainText(/Unavailable/);
  await disclosure(page, details, 'Price evidence').locator('summary').click();
  await expect(disclosure(page, details, 'Price evidence')).toHaveJSProperty('open', true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await details.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

test('[PRICE-09] distinguishes known zero, a small positive rate and unknown prices across the strip, details and job', async ({ page }) => {
  await openPrices(page);
  const lehi = page.getByRole('region', { name: 'Lehi prices', exact: true });
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  const job = page.getByRole('region', { name: 'Job choice', exact: true });

  await show(page, 'zero');
  await expect(lehiHour(page, '12:00')).toHaveAccessibleName(/\$0\.00 per GPU-hour, Available now/);
  for (const region of [lehi, details, job]) await expect(region.getByText('$0.00', { exact: false }).first()).toBeVisible();
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();

  await show(page, 'tiny');
  await expect(lehiHour(page, '12:00')).toHaveAccessibleName(/<\$0\.000001 per GPU-hour, Available now/);
  for (const region of [lehi, details, job]) await expect(region.getByText('<$0.000001', { exact: false }).first()).toBeVisible();

  await show(page, 'unknown');
  await expect(lehiHour(page, '12:00')).toHaveAccessibleName(/Unavailable/);
  await expect(lehiHour(page, '12:00')).not.toHaveAccessibleName(/\$/);
  await expect(details.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  await expect(job).not.toContainText(/\$/);
});

test('[PRICE-10] leaves a missing energy estimate unavailable while retaining the supplied selection', async ({ page }) => {
  await openPrices(page);
  await show(page, 'no-estimate');
  const job = page.getByRole('region', { name: 'Job choice', exact: true });

  await expect(job.getByText('Energy estimate not supplied', { exact: true })).toBeVisible();
  await expect(job).toContainText('Selected · not executed');
  await expect(job).toContainText('1 GPU');
  await expect(job).not.toContainText(/\b0(?:\.0+)?\s*kWh|0 GPU-hours|No work/i);
  await expect(lehiHour(page, '12:00').getByText('Selected', { exact: true })).toBeVisible();
});

test('[PRICE-11] distinguishes the same UTC hour on different days without moving the current selection', async ({ page }) => {
  await openPrices(page);
  await show(page, 'overnight');
  const lehi = page.getByRole('region', { name: 'Lehi prices', exact: true });
  const day28 = lehi.getByRole('button', { name: /^Inspect Lehi, 12:00 UTC,.*28 Oct 2026/ });
  const day29 = lehi.getByRole('button', { name: /^Inspect Lehi, 12:00 UTC,.*29 Oct 2026/ });
  await expect(day28).toHaveCount(1);
  await expect(day29).toHaveCount(1);
  await expect(lehi.getByText('28 Oct 2026', { exact: false }).first()).toBeVisible();
  await expect(lehi.getByText('29 Oct 2026', { exact: false }).first()).toBeVisible();
  await expect(day28.getByText('Selected', { exact: true })).toBeVisible();

  await day29.click();
  const details = page.getByRole('region', { name: 'Price details', exact: true });
  await expect(details.getByRole('heading', { level: 3 })).toContainText('29 Oct 2026');
  await expect(details.getByText('$0.045', { exact: false }).first()).toBeVisible();
  await expect(details.getByText('Conditional forecast', { exact: true })).toBeVisible();
  await expect(day28.getByText('Selected', { exact: true })).toBeVisible();
  await expect(day29.getByText('Selected', { exact: true })).toHaveCount(0);

  await day28.click();
  await expect(details.getByRole('heading', { level: 3 })).toContainText('28 Oct 2026');
  await expect(details.getByText('$0.075', { exact: false }).first()).toBeVisible();
  await expect(details.getByText('Available now', { exact: true })).toBeVisible();
});
