import { expect, test, type Page } from '@playwright/test';
import snapshots from '../../fixtures/legacy/energy/snapshots.json' with { type: 'json' };
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type';

const tileRequests = /^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//;

test.beforeEach(async ({ page }) => {
  await page.route(tileRequests, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/></svg>',
  }));
});

async function openReportDetails(page: Page) {
  const report = page.getByRole('region', { name: 'Job report', exact: true });
  if (await report.locator('details').getAttribute('open') === null) {
    await report.getByText('Report details', { exact: true }).click();
  }
  return report;
}

async function holdRoutingResponses(page: Page) {
  await page.route('**/test/fixtures/legacy/scheduling/fakeRouter.ts*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const pending = new Map();
      globalThis.completeTestRouting = (jobId, outcome) => {
        const complete = pending.get(jobId);
        if (!complete) throw new Error('No pending routing for ' + jobId);
        pending.delete(jobId);
        complete(outcome);
      };
      export function routeFakeJob(job) {
        return new Promise(resolve => pending.set(job.id, resolve));
      }
    `,
  }));

  return async (jobId: string, locationId: 'fake-utah-grid' | 'fake-utah-solar') => {
    const site = snapshots.sites.find(item => item.id === locationId)!;
    const slot = site.snapshot.slot;
    const outcome: JobOutcome = {
      selected: true,
      allocation: {
        jobId, slot: { locationId, slotId: slot.id }, slotVersion: site.snapshot.version,
        allocatedGpus: 1, kWhPerGpuHour: 1, requiredPowerKW: 1,
        energy: [{ window: slot.window, estimatedKWh: 1 }], forecast: {},
        postedUsdPerGpuHour: slot.postedUsdPerGpuHour, priceBasis: slot.priceBasis,
      },
      explanation: 'Supplied routing response; execution has not started.',
    };
    await page.evaluate(({ jobId, outcome }) => {
      const testRouting = globalThis as typeof globalThis & {
        completeTestRouting: (jobId: string, outcome: JobOutcome) => void;
      };
      testRouting.completeTestRouting(jobId, outcome);
    }, { jobId, outcome });
  };
}
test('[BOOT-01] opens the React application', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Sunchaser');
  await expect(page.getByRole('heading', { name: 'Sunchaser', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('retains independent routed jobs and reports with reduced motion and a paused clock', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-10-27T17:59:00Z') });
  await page.clock.pauseAt(new Date('2026-10-27T18:00:00Z'));
  await page.goto('/test/userflows/legacy/index.html?scenario=fake-preview');
  await expect(page.getByText('Fake preview — fixed data; no work is executed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Energy sites' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job report', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Observed impact report' })).toHaveCount(0);

  const basemap = page.getByRole('region', { name: 'US energy map' });
  const placement = basemap.getByRole('img', { name: /^Job placement:/ });
  const origin = basemap.getByRole('button', { name: 'Inspect Utah grid example', exact: true });
  const destination = basemap.getByRole('button', { name: 'Inspect Utah solar example', exact: true });
  const routePath = placement.locator('path.job-route[data-selected="true"]');
  const assignedJob = basemap.getByRole('img', { name: 'Assigned job fake-job', exact: true });
  const impact = basemap.getByRole('region', { name: 'Job impact', exact: true });
  await expect(placement).toBeVisible();
  await expect(origin).toHaveAttribute('data-origin', 'true');
  await expect(origin.getByRole('img', { name: 'Job request fake-job', exact: true })).toBeVisible();
  await expect(basemap.locator('.job-request-marker, .job-request-anchor')).toHaveCount(0);
  await expect(routePath).toHaveCount(0);
  await expect(assignedJob).toHaveCount(0);
  await expect(impact).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Read job report' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Route Fake job', exact: true }).click();
  const stream = page.getByRole('region', { name: 'Job stream', exact: true });
  const firstJob = stream.getByRole('button', { name: 'Inspect job fake-job', exact: true });
  await expect(firstJob).toContainText('Selected');
  await expect(firstJob).toHaveAttribute('aria-pressed', 'true');
  await expect(impact).toBeVisible();
  await expect(impact.getByText('Planned energy', { exact: true })).toBeVisible();
  await expect(impact.getByText('~1.00 kWh', { exact: true })).toBeVisible();
  await expect(impact.getByText('Carbon change', { exact: true })).toBeVisible();
  await expect(impact.getByText('Modeled cost change', { exact: true })).toBeVisible();
  const unavailableChanges = impact.getByText('—', { exact: true });
  await expect(unavailableChanges).toHaveCount(2);
  await expect(impact.getByText('Carbon change', { exact: true }).locator('..')).toHaveAttribute('title', 'Execution measurements have not been observed.');
  await expect(impact.getByText('Modeled cost change', { exact: true }).locator('..')).toHaveAttribute('title', 'Execution measurements have not been observed.');
  await expect(placement).toHaveAccessibleName('Job placement: fake-job assigned from Utah grid example to Utah solar example; execution not started');
  await expect(placement.locator('path.job-stay')).toHaveCount(0);
  await expect(routePath).toHaveCount(1);
  await expect(routePath).toHaveAttribute('data-location-id', 'fake-utah-solar');
  await expect(routePath).toHaveAttribute('data-origin-location-id', 'fake-utah-grid');
  await expect(origin).toHaveAttribute('data-selected', 'false');
  await expect(destination).toHaveAttribute('data-selected', 'true');
  await expect(routePath).toBeVisible();
  await expect(routePath).toHaveCSS('animation-name', 'none');
  await expect(assignedJob).toHaveCount(1);
  await expect(assignedJob).toBeVisible();
  await expect(destination.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect Utah grid example', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect Utah solar example', exact: true })).toBeVisible();

  const observed = await openReportDetails(page);
  await expect(observed.getByText('Submitted job: fake-job', { exact: true })).toBeVisible();
  await expect(observed.getByText('Comparison: unavailable', { exact: true })).toBeVisible();
  await expect(observed.getByText('Requested work: 1 GPU-hour', { exact: true })).toBeVisible();
  await expect(observed.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
  await expect(observed.getByText('Selected window: 2026-10-27T18:00:00Z → 2026-10-27T19:00:00Z', { exact: true })).toBeVisible();
  await expect(observed.getByText('Posted price: $0.00/GPU-hour', { exact: true })).toBeVisible();
  const report = observed.getByRole('table', { name: 'Observed impact report' });
  await expect(report.getByRole('row', { name: /Carbon/ }).getByRole('cell')).toHaveText(['Unavailable', 'Unavailable']);
  await expect(report.getByRole('row', { name: /Modeled cost/ }).getByRole('cell')).toHaveText(['Unavailable', 'Unavailable']);
  await expect(observed.getByText('Observed Fake job flow — no work has executed.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Route next Fake job', exact: true }).click();
  const secondJob = stream.getByRole('button', { name: 'Inspect job fake-job-2', exact: true });
  await expect(stream.getByRole('button', { name: /^Inspect job / })).toHaveCount(2);
  await expect(firstJob).toContainText('Selected');
  await expect(secondJob).toContainText('Selected');
  await expect(secondJob).toHaveAttribute('aria-pressed', 'true');
  await openReportDetails(page);
  await expect(observed.getByText('Submitted job: fake-job-2', { exact: true })).toBeVisible();
  await expect(placement).toHaveAccessibleName('Job placement: fake-job-2 assigned from Utah grid example to Utah solar example; execution not started');
  await expect(destination.getByRole('img', { name: 'Assigned job fake-job-2', exact: true })).toBeVisible();
  await expect(assignedJob).toHaveCount(0);
  await expect(impact.getByText('fake-job-2', { exact: true })).toBeVisible();

  await firstJob.click();
  await expect(firstJob).toHaveAttribute('aria-pressed', 'true');
  await expect(secondJob).toHaveAttribute('aria-pressed', 'false');
  await expect(stream.getByRole('button', { name: /^Inspect job / })).toHaveCount(2);
  await openReportDetails(page);
  await expect(observed.getByText('Submitted job: fake-job', { exact: true })).toBeVisible();
  await expect(placement).toHaveAccessibleName('Job placement: fake-job assigned from Utah grid example to Utah solar example; execution not started');
  await expect(impact).toHaveCount(1);
  await expect(impact.getByText('fake-job', { exact: true })).toBeVisible();
  await expect(impact.getByText('~1.00 kWh', { exact: true })).toBeVisible();
  await expect(unavailableChanges).toHaveCount(2);
  await expect(routePath).toHaveCount(1);
  await expect(routePath).toBeVisible();
  await expect(routePath).toHaveCSS('animation-name', 'none');
  await expect(assignedJob).toHaveCount(1);
  await expect(assignedJob).toBeVisible();
  await expect(observed.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse('2026-10-27T18:00:00Z'));
});

test('keeps each job report and map attached when routing responses arrive out of order', async ({ page }) => {
  const finishRouting = await holdRoutingResponses(page);
  await page.goto('/test/userflows/legacy/index.html?scenario=fake-preview');
  await page.getByRole('button', { name: 'Route Fake job', exact: true }).click();
  const stream = page.getByRole('region', { name: 'Job stream', exact: true });
  const firstJob = stream.getByRole('button', { name: 'Inspect job fake-job', exact: true });
  await expect(firstJob).toContainText('Routing');
  const routeNext = page.getByRole('button', { name: 'Route next Fake job', exact: true });
  await expect(routeNext).toBeEnabled();
  await routeNext.click();
  const secondJob = stream.getByRole('button', { name: 'Inspect job fake-job-2', exact: true });
  await expect(secondJob).toContainText('Routing');
  await expect(secondJob).toHaveAttribute('aria-pressed', 'true');
  await expect(firstJob).toContainText('Routing');
  const report = await openReportDetails(page);
  await expect(report.getByText('Submitted job: fake-job-2', { exact: true })).toBeVisible();

  await finishRouting('fake-job-2', 'fake-utah-solar');
  await expect(secondJob).toContainText('Selected');
  await expect(firstJob).toContainText('Routing');
  await expect(report.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
  const basemap = page.getByRole('region', { name: 'US energy map' });
  const placement = basemap.getByRole('img', { name: /^Job placement:/ });
  const impact = basemap.getByRole('region', { name: 'Job impact', exact: true });
  await expect(placement).toHaveAccessibleName('Job placement: fake-job-2 assigned from Utah grid example to Utah solar example; execution not started');
  await expect(impact.getByText('fake-job-2', { exact: true })).toBeVisible();

  await basemap.getByRole('button', { name: 'Inspect Utah solar example', exact: true }).click();
  const siteDetails = basemap.getByRole('region', { name: 'Site details', exact: true });
  await expect(siteDetails).toBeVisible();
  await expect(siteDetails).toContainText('Utah solar example');

  await finishRouting('fake-job', 'fake-utah-grid');
  await expect(firstJob).toContainText('Selected');
  await expect(siteDetails).toBeVisible();
  await expect(siteDetails).toContainText('Utah solar example');
  await expect(secondJob).toHaveAttribute('aria-pressed', 'true');
  await expect(report.getByText('Submitted job: fake-job-2', { exact: true })).toBeVisible();
  await expect(report.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
  await expect(placement).toHaveAccessibleName('Job placement: fake-job-2 assigned from Utah grid example to Utah solar example; execution not started');
  await expect(impact.getByText('fake-job-2', { exact: true })).toBeVisible();

  await firstJob.click();
  await openReportDetails(page);
  await expect(report.getByText('Submitted job: fake-job', { exact: true })).toBeVisible();
  await expect(report.getByText('Selected location: Utah grid example', { exact: true })).toBeVisible();
  await expect(placement).toHaveAccessibleName('Job placement: fake-job stays at Utah grid example; execution not started');
  await expect(placement.locator('path.job-stay')).toHaveCount(1);
  await expect(placement.locator('path.job-route')).toHaveCount(0);
  await expect(impact.getByText('fake-job', { exact: true })).toBeVisible();
  await expect(impact.getByText('—', { exact: true })).toHaveCount(2);

  await secondJob.click();
  await openReportDetails(page);
  await expect(report.getByText('Submitted job: fake-job-2', { exact: true })).toBeVisible();
  await expect(report.getByText('Selected location: Utah solar example', { exact: true })).toBeVisible();
  await expect(placement.locator('path.job-route')).toHaveCount(1);
  await expect(stream.getByRole('button', { name: /^Inspect job / })).toHaveCount(2);
});
