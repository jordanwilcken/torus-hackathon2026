import { expect, test, type Page } from '@playwright/test';
import type { Job } from '../../../src/core/jobs/Job.type';
import type { JobState } from '../../../src/core/jobs/JobState.type';

type PreviewControl = {
  read(): Job[];
  initial(): Job;
  setHold(value: boolean): void;
  failNext(message: string): void;
  release(): void;
  showState(state: JobState, details?: { slackHours?: number; projectedFinishAt?: string; carbonKg?: number;
    decisions?: readonly { at: string; reason: string }[] }): void;
};
declare global { interface Window { jobPreview: PreviewControl } }

async function openPreview(page: Page) {
  await page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/><path d="M0 90h256M80 0v256" stroke="#cad9ce" stroke-width="2"/></svg>',
  }));
  await page.goto('/test/userflows/jobs/fixture.html');
  await expect(page.getByRole('region', { name: 'US energy map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build job', exact: true })).toBeVisible();
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Build job', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Build job', exact: true });
  await expect(editor).toBeVisible();
  return editor;
}

async function received(page: Page) { return page.evaluate(() => window.jobPreview.read()); }

test('[JOBS-01] opens a keyboard-accessible editor over the map and restores focus on Escape', async ({ page }) => {
  await openPreview(page);
  const launcher = page.getByRole('button', { name: 'Build job', exact: true });
  await launcher.hover();
  await launcher.focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Build job', exact: true });
  await expect(editor).toBeVisible();
  await expect(launcher.locator('svg')).toBeVisible();
  await expect(editor.getByLabel('Workload', { exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'US energy map' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Job placement: preview-job-1 waiting at Utah grid example/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(launcher).toBeFocused();
});

test('[JOBS-02] submits entered requirements while preserving caller-owned job context', async ({ page }) => {
  await openPreview(page);
  const original = await page.evaluate(() => window.jobPreview.initial());
  const editor = await openEditor(page);
  await editor.getByLabel('Workload', { exact: true }).fill('Train Utah model');
  await editor.getByLabel('Work (GPU-hours)', { exact: true }).fill('4');
  await editor.getByLabel('GPU limit', { exact: true }).fill('2');
  await editor.getByLabel('Deadline (UTC)', { exact: true }).fill('2026-10-27T22:00');
  await editor.getByText('Data & context', { exact: false }).click();
  await editor.getByLabel('Data (GB)', { exact: true }).fill('12');
  await editor.getByRole('checkbox', { name: 'Utah grid example' }).uncheck();
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect.poll(() => received(page)).toHaveLength(1);
  expect((await received(page))[0]).toEqual({ ...original, workloadRef: 'Train Utah model', workGpuH: 4,
    remainingGpuH: 4, maxGpus: 2, dataGB: 12, state: 'queued', allowedLocations: ['fake-utah-solar'],
    window: { ...original.window, endAt: '2026-10-27T22:00:00.000Z' } });
  expect(await page.evaluate(() => window.jobPreview.initial())).toEqual(original);
  await expect(editor).toBeHidden();
  await openEditor(page);
  await page.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect.poll(() => received(page)).toHaveLength(2);
  expect((await received(page))[1].id).toBe('preview-job-2');
});

for (const invalid of [
  { label: 'nonpositive work', field: 'Work (GPU-hours)', value: '0' },
  { label: 'fractional GPU limit', field: 'GPU limit', value: '1.5' },
  { label: 'deadline before readiness', field: 'Deadline (UTC)', value: '2026-10-27T17:00' },
] as const) {
  test(`[JOBS-03] rejects ${invalid.label} without sending a job`, async ({ page }) => {
    await openPreview(page);
    const editor = await openEditor(page);
    await editor.getByLabel(invalid.field, { exact: true }).fill(invalid.value);
    await editor.getByRole('button', { name: 'Send to scheduler' }).click();
    expect(await received(page)).toEqual([]);
    await expect(editor).toBeVisible();
    await expect.poll(async () => await editor.locator(':invalid').count() + await editor.getByRole('alert').count()).toBeGreaterThan(0);
  });
}

test('[JOBS-04] requires at least one allowed site', async ({ page }) => {
  await openPreview(page);
  const editor = await openEditor(page);
  await editor.getByRole('checkbox', { name: 'Utah grid example' }).uncheck();
  await editor.getByRole('checkbox', { name: 'Utah solar example' }).uncheck();
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  expect(await received(page)).toEqual([]);
  await expect(editor.getByRole('alert')).toBeVisible();
});

test('[JOBS-05] prevents duplicate submission while the callback is pending', async ({ page }) => {
  await openPreview(page);
  await page.evaluate(() => window.jobPreview.setHold(true));
  const editor = await openEditor(page);
  const send = editor.getByRole('button', { name: /Send to scheduler|Sending/ });
  await send.click();
  await expect(send).toBeDisabled();
  await editor.locator('form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  expect(await received(page)).toHaveLength(1);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.jobPreview.release());
  await expect(editor).toBeHidden();
  expect(await received(page)).toHaveLength(1);
});

test('[JOBS-06] keeps the draft after a failed submission so it can be retried', async ({ page }) => {
  await openPreview(page);
  await page.evaluate(() => window.jobPreview.failNext('Scheduler unavailable'));
  const editor = await openEditor(page);
  await editor.getByLabel('Workload', { exact: true }).fill('Retry this batch');
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect(editor.getByRole('alert')).toContainText('Scheduler unavailable');
  await expect(editor.getByLabel('Workload', { exact: true })).toHaveValue('Retry this batch');
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect(editor).toBeHidden();
  expect((await received(page)).map(job => job.workloadRef)).toEqual(['Retry this batch', 'Retry this batch']);
});

test('[JOBS-07] displays supplied lifecycle and evidence without inventing carbon savings', async ({ page }) => {
  await openPreview(page);
  const details = page.getByRole('article', { name: 'Job details' });
  const carbon = details.getByText('Carbon used', { exact: true }).locator('..').locator('dd');
  for (const state of ['queued', 'moving', 'running', 'paused', 'done', 'missed'] as const) {
    await page.evaluate(state => window.jobPreview.showState(state), state);
    await expect(details).toContainText(new RegExp(state, 'i'));
    await expect(carbon).toHaveText('Unavailable');
  }
  await page.evaluate(() => window.jobPreview.showState('running', { slackHours: 1.5,
    projectedFinishAt: '2026-10-27T18:45:00Z', carbonKg: .25,
    decisions: [{ at: '2026-10-27T18:00:00Z', reason: 'Waiting for supplied solar capacity' }] }));
  await expect(details).toContainText('1.5');
  await expect(details).toContainText('18:45');
  await expect(carbon).toHaveText('0.25 kg');
  await details.getByText('Decision history', { exact: false }).click();
  await expect(details).toContainText('Waiting for supplied solar capacity');
  await page.evaluate(() => window.jobPreview.showState('done', { carbonKg: 0 }));
  await expect(carbon).toHaveText('0 kg');
});

test('[JOBS-09] accepts fractional GPU-hours without rounding the requested work', async ({ page }) => {
  await openPreview(page);
  const editor = await openEditor(page);
  await editor.getByLabel('Work (GPU-hours)', { exact: true }).fill('0.25');
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect.poll(() => received(page)).toHaveLength(1);
  expect((await received(page))[0]).toMatchObject({ workGpuH: .25, remainingGpuH: .25, maxGpus: 1 });
  await expect(editor).toBeHidden();
});

test('[JOBS-08] fits mobile and interacting with the editor leaves map geography fixed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview(page);
  const editor = await openEditor(page);
  const origin = page.locator('[data-origin-location-id="fake-utah-grid"]').first();
  const before = await origin.boundingBox();
  const bounds = await editor.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  const workload = editor.getByLabel('Workload', { exact: true });
  await workload.fill('Mobile batch');
  const input = (await workload.boundingBox())!;
  await page.mouse.move(input.x + 15, input.y + input.height / 2);
  await page.mouse.down();
  await page.mouse.move(input.x + 60, input.y + input.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await origin.boundingBox()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor.getByRole('button', { name: 'Close job editor' }).click();
  await expect(editor).toBeHidden();
});

test('[JOBS-10] reveals and focuses invalid data inside a collapsed section', async ({ page }) => {
  await openPreview(page);
  const editor = await openEditor(page);
  const section = editor.getByText('Data & context', { exact: false });
  await section.click();
  const data = editor.getByLabel('Data (GB)', { exact: true });
  await data.fill('-1');
  await section.click();
  await expect(data).toBeHidden();
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  expect(await received(page)).toEqual([]);
  await expect(data).toBeVisible();
  await expect(data).toBeFocused();
});

test('[JOBS-11] submitting a job shows its selected site and route on the map', async ({ page }) => {
  await openPreview(page);
  const editor = await openEditor(page);
  await editor.getByLabel('Workload', { exact: true }).fill('Visible routing example');
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect(editor).toBeHidden();
  const result = page.getByRole('status', { name: 'Routing result' });
  await expect(result).toContainText('Utah solar example');
  await expect(page.getByRole('img', { name: 'Job placement: preview-job-1 assigned from Utah grid example to Utah solar example; execution not started', exact: true })).toBeVisible();
  await expect(page.locator('.job-route[data-origin-location-id="fake-utah-grid"][data-location-id="fake-utah-solar"]')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Job details' })).toContainText('Visible routing example');
  await expect(result).toContainText('execution not started');
  const progress = page.getByRole('progressbar', { name: 'Completed work' });
  await expect(progress).toHaveAttribute('value', '0');
});

test('[JOBS-12] allowing only the origin visibly keeps the job there', async ({ page }) => {
  await openPreview(page);
  const editor = await openEditor(page);
  await editor.getByRole('checkbox', { name: 'Utah solar example' }).uncheck();
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect(page.getByRole('status', { name: 'Routing result' })).toContainText('Utah grid example');
  await expect(page.getByRole('img', { name: 'Job placement: preview-job-1 stays at Utah grid example; execution not started', exact: true })).toBeVisible();
  await expect(page.locator('.job-route')).toHaveCount(0);
});

test('[JOBS-13] a job that cannot meet its deadline gets an explicit routing result', async ({ page }) => {
  await openPreview(page);
  const editor = await openEditor(page);
  await editor.getByLabel('Work (GPU-hours)', { exact: true }).fill('2');
  await editor.getByRole('button', { name: 'Send to scheduler' }).click();
  await expect(editor).toBeHidden();
  const result = page.getByRole('status', { name: 'Routing result' });
  await expect(result).toContainText('No site selected');
  await expect(result).toContainText('cannot finish before the deadline');
  await expect(page.locator('.job-route')).toHaveCount(0);
});
