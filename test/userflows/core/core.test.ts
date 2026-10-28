import { expect, test } from '@playwright/test';

test('[BOOT-01] opens the React application', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Sunchaser');
  await expect(page.getByRole('heading', { name: 'Sunchaser', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('updates the observed job report immediately without advancing the clock', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-27T17:59:00Z') });
  await page.clock.pauseAt(new Date('2026-10-27T18:00:00Z'));
  await page.goto('/');
  await expect(page.getByText('Fake preview — fixed data; no work is executed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Energy map data' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job report', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Utah grid example/ })).toContainText('$0.09');
  await expect(page.getByRole('row', { name: /Utah solar example/ })).toContainText('$0.00');
  await expect(page.getByRole('table', { name: 'Observed impact report' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Read job report' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit Fake job' }).click();
  const observed = page.getByRole('region', { name: 'Job report', exact: true });
  await expect(observed.getByText('Submitted job: fake-job', { exact: true })).toBeVisible();
  await expect(page.getByText('Comparison: unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Selected Utah solar example');
  await expect(observed.getByText('Submitted job: fake-job', { exact: true })).toBeVisible();
  await expect(observed.getByText('Requested work: 1 GPU-hour', { exact: true })).toBeVisible();
  await expect(observed.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
  await expect(observed.getByText('Selected window: 2026-10-27T18:00:00Z → 2026-10-27T19:00:00Z', { exact: true })).toBeVisible();
  await expect(observed.getByText('Posted price: $0.00/GPU-hour', { exact: true })).toBeVisible();
  await expect(observed.getByText('Carbon forecast: 400 gCO2/kWh · fake-regional-carbon', { exact: true })).toBeVisible();
  const report = page.getByRole('table', { name: 'Observed impact report' });
  await expect(report.getByRole('row', { name: /Carbon/ }).getByRole('cell')).toHaveText(['Unavailable', 'Unavailable']);
  await expect(report.getByRole('row', { name: /Modeled cost/ }).getByRole('cell')).toHaveText(['Unavailable', 'Unavailable']);
  await expect(observed.getByText('Observed Fake job flow — no work has executed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit Fake job' }).click();
  await expect(observed.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
});
