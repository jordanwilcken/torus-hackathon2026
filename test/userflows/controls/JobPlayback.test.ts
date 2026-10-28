import { expect, test, type Page } from '@playwright/test';

async function openPlayback(page: Page) {
  await page.route(/^https:\/\/tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }));
  await page.goto('/test/userflows/controls/fixture.html?view=stream');
  await page.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
  return page.getByRole('dialog', { name: 'Chaos monkey', exact: true });
}

async function advanceHour(page: Page, completed: number) {
  const dialog = page.getByRole('dialog', { name: 'Chaos monkey', exact: true });
  await dialog.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText(completed + ' / 4');
}

test('arrivals choose current sites, wait for cheaper hours, and reconsider the waiting job', async ({ page }) => {
  await openPlayback(page);
  await expect(page.getByRole('heading', { name: 'Job stream playback', exact: true })).toBeVisible();
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Upcoming');
  await advanceHour(page, 1);
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-solar at 18:00 UTC');
  await expect(page.getByRole('img', { name: /Job placement: job-01 assigned.*Utah solar example; execution not started/ })).toBeAttached();
  await expect(page.locator('.job-route[data-location-id="utah-solar"]')).toHaveCount(1);
  await advanceHour(page, 2);
  await expect(page.getByLabel('job-02 decision', { exact: true })).toHaveText('Waiting at 19:00 UTC');
  await expect(page.getByRole('button', { name: 'Inspect Utah grid example', exact: true })).toContainText('current evidence');
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('Waiting: supplied cheaper future slots at utah-solar');
  await page.evaluate(() => document.body.addEventListener('animationend', event => {
    if (event.animationName === 'confirm-placement') document.body.dataset.placementFinished = 'true';
  }));
  await advanceHour(page, 3);
  await expect(page.locator('body')).toHaveAttribute('data-placement-finished', 'true');
  await expect(page.getByLabel('job-03 decision', { exact: true })).toHaveText('Selected utah-grid at 20:00 UTC');
  await expect(page.getByLabel('job-02 decision', { exact: true })).toHaveText('Waiting at 20:00 UTC');
  await advanceHour(page, 4);
  await expect(page.getByLabel('job-02 decision', { exact: true })).toHaveText('Selected utah-solar at 21:00 UTC');
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('19:00 UTC');
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('20:00 UTC');
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('21:00 UTC');
  await expect(page.getByRole('img', { name: /Job placement: job-02.*execution not started/ })).toBeAttached();
  await expect(page.getByText('Selections only: capacity is not reserved and work has not executed.', { exact: true })).toBeVisible();
});

test('Play advances arrivals automatically and Pause stops before the next hour', async ({ page }) => {
  const dialog = await openPlayback(page);
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-solar at 18:00 UTC');
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 4');
  await expect(dialog.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
  await page.clock.install();
  await page.clock.runFor(30_000);
  await expect(page.getByLabel('job-02 decision', { exact: true })).toHaveText('Upcoming');
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 4');
});

test('Reset replays the same inputs and finished playback retains inspectable decisions', async ({ page }) => {
  const dialog = await openPlayback(page);
  await dialog.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('4');
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(dialog.getByLabel('Playback status', { exact: true })).toHaveText('complete', { timeout: 15_000 });
  await expect(page.getByLabel('job-03 decision', { exact: true })).toHaveText('Selected utah-grid at 20:00 UTC');
  await page.getByRole('button', { name: 'Inspect job-03', exact: true }).click();
  await expect(page.getByRole('img', { name: /Job placement: job-03.*Utah grid example; execution not started/ })).toBeAttached();
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('0.08 USD/GPU-hour');
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(dialog.getByLabel('Simulation hour', { exact: true })).toHaveText('0 / 4');
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Upcoming');
  await advanceHour(page, 1);
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-solar at 18:00 UTC');
});

test('a routing failure stops playback and shows the failed decision with Reset available', async ({ page }) => {
  // This case exercises the controller's failed-dependency contract; the other cases use the real chooser.
  await page.route(/\/src\/core\/scheduling\/chooseExecutionSlot\.ts(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function chooseExecutionSlot() { throw new Error("Slot lookup failed"); }',
  }));
  const dialog = await openPlayback(page);
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Routing failed');
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('Slot lookup failed');
  await expect(dialog.getByLabel('Playback status', { exact: true })).toHaveText('paused');
  await expect(dialog.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Upcoming');
});

test('a solar outage changes the first placement and Reset restores the original scenario', async ({ page }) => {
  const dialog = await openPlayback(page);
  await expect(dialog.getByRole('combobox', { name: 'Scenario event', exact: true })).toBeEnabled();
  await dialog.getByRole('combobox', { name: 'Scenario event', exact: true }).selectOption('site-outage');
  await dialog.getByRole('button', { name: 'Apply event', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scenario events', exact: true })).toContainText('Scheduled for 18:00 UTC');
  await advanceHour(page, 1);
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-grid at 18:00 UTC');
  await expect(page.getByRole('region', { name: 'Scenario events', exact: true })).toContainText('Applied at 18:00 UTC');
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await advanceHour(page, 1);
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-solar at 18:00 UTC');
});

test('a forecast error changes the waiting decision without changing an earlier placement', async ({ page }) => {
  const dialog = await openPlayback(page);
  await advanceHour(page, 1);
  await dialog.getByRole('combobox', { name: 'Scenario event', exact: true }).selectOption('forecast-error');
  await dialog.getByRole('button', { name: 'Apply event', exact: true }).click();
  await advanceHour(page, 2);
  await expect(page.getByLabel('job-02 decision', { exact: true })).toHaveText('Selected utah-solar at 19:00 UTC');
  await page.getByRole('button', { name: 'Inspect job-01', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Decision history' })).toContainText('0.1 USD/GPU-hour');
});

test('a utility limit removes the grid option for the third job', async ({ page }) => {
  const dialog = await openPlayback(page);
  await dialog.getByRole('combobox', { name: 'Scenario event', exact: true }).selectOption('utility-import-limit');
  await dialog.getByRole('button', { name: 'Apply event', exact: true }).click();
  await advanceHour(page, 1);
  await advanceHour(page, 2);
  await advanceHour(page, 3);
  await expect(page.getByLabel('job-03 decision', { exact: true })).toHaveText('Selected utah-solar at 20:00 UTC');
});

test('a supplied protected-reserve scenario removes discretionary solar capacity', async ({ page }) => {
  const dialog = await openPlayback(page);
  await dialog.getByRole('combobox', { name: 'Scenario event', exact: true }).selectOption('reserve-change');
  await dialog.getByRole('button', { name: 'Apply event', exact: true }).click();
  await advanceHour(page, 1);
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-grid at 18:00 UTC');
  await expect(page.getByRole('region', { name: 'Scenario events', exact: true })).toContainText('Applied at 18:00 UTC');
});

test('an event can be queued during playback and takes effect on the next hour', async ({ page }) => {
  await page.clock.install();
  const dialog = await openPlayback(page);
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Scenario event', exact: true })).toBeEnabled();
  await dialog.getByRole('combobox', { name: 'Scenario event', exact: true }).selectOption('forecast-error');
  await dialog.getByRole('button', { name: 'Apply event', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scenario events', exact: true })).toContainText('Scheduled for 19:00 UTC');
  await page.clock.runFor(6000);
  await expect(page.getByLabel('job-01 decision', { exact: true })).toHaveText('Selected utah-solar at 18:00 UTC');
  await expect(page.getByLabel('job-02 decision', { exact: true })).toHaveText('Selected utah-solar at 19:00 UTC');
  await expect(page.getByRole('region', { name: 'Scenario events', exact: true })).toContainText('Applied at 19:00 UTC');
});
