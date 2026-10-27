import { expect, test } from '@playwright/test';

test('[BOOT-01] opens the React application', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Sunchaser');
  await expect(page.getByRole('heading', { name: 'Sunchaser', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
