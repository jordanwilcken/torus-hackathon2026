import { expect, test } from '@playwright/test';

test('[BOOT-01] opens the React application', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Sunchaser');
  await expect(page.getByRole('heading', { name: 'Sunchaser', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('previews the Fake job, map and separate saved report', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Fake preview — fixed data; no work is executed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Energy map data' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Utah grid example/ })).toContainText('$0.09');
  await expect(page.getByRole('row', { name: /Utah solar example/ })).toContainText('$0.00');
  await expect(page.getByRole('table', { name: 'Saved impact comparison' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Submit Fake job' }).click();
  await expect(page.getByRole('status')).toContainText('Selected Utah solar example');
  // Selecting a slot must not manufacture a completed-work report.
  await expect(page.getByRole('table', { name: 'Saved impact comparison' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Read Fake report' }).click();
  await expect(page.getByText('Comparison: illustrative', { exact: true })).toBeVisible();
  const report = page.getByRole('table', { name: 'Saved impact comparison' });
  await expect(report.getByRole('row', { name: /Carbon/ })).toContainText('0.40');
  await expect(report.getByRole('row', { name: /Modeled cost/ })).toContainText('$0.09');
  await expect(page.getByText('Fake report — illustrative comparison, not a record of job execution.')).toBeVisible();
});
