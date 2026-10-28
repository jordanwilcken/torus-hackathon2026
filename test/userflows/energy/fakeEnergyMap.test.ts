import { expect, test, type Page } from '@playwright/test';
import snapshots from '../../../src/core/energy/fakes/snapshots.json' with { type: 'json' };
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type';

const tileRequests = /^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//;

test.beforeEach(async ({ page }) => {
  await page.route(tileRequests, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/></svg>',
  }));
});

async function useFakeSnapshots(page: Page, data: unknown) {
  await page.route('**/src/core/energy/fakes/snapshots.json*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export default ' + JSON.stringify(data) + ';',
  }));
}

test('drills from US regional references into Utah sites and keeps viewing separate from job selection', async ({ page }) => {
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Energy sites' });
  const overviewMap = map.getByRole('region', { name: 'US energy map' });
  await expect(overviewMap.getByRole('button', { name: /^Inspect .* region$/ })).toHaveCount(5);
  await expect(overviewMap.getByRole('button', { name: 'Explore Utah sites', exact: true })).toHaveCount(0);
  await expect(overviewMap.getByRole('button', { name: 'Inspect Utah grid example', exact: true })).toHaveAttribute('data-origin', 'true');
  await expect(map.getByRole('region', { name: 'Site details' })).toHaveCount(0);
  await overviewMap.getByRole('button', { name: 'Inspect CISO region', exact: true }).click();
  const overview = map.getByRole('region', { name: 'Regional overview' });
  await expect(overview).toContainText('San Jose, CA');
  await expect(overview).toContainText(/energy data.*not connected/i);
  await expect(overview.getByRole('button', { name: 'View Utah sites', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(overview).toHaveCount(0);
  await map.getByRole('button', { name: 'Show US', exact: true }).click();
  await expect(overviewMap.getByRole('button', { name: 'Inspect CISO region', exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  const basemap = map.getByRole('region', { name: 'US energy map' });
  await expect(map.locator('.leaflet-container')).toBeVisible();
  await expect(basemap.locator('img.leaflet-tile').first()).toHaveAttribute('src', /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
  await expect(basemap.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Show US', exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Explore Utah', exact: true })).toBeVisible();
  await expect(basemap.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  await expect(basemap.getByRole('button', { name: 'Zoom out', exact: true })).toBeVisible();

  const grid = map.getByRole('button', { name: 'Inspect Utah grid example', exact: true });
  const solar = map.getByRole('button', { name: 'Inspect Utah solar example', exact: true });
  const details = map.getByRole('region', { name: 'Site details' });
  await expect(details).toHaveCount(0);
  await grid.hover();
  await expect(details).toBeVisible();
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toContainText('Viewing');
  await expect(details).toContainText('Utah grid example');
  await expect(details).toContainText('$0.09');
  const timeline = map.getByRole('region', { name: 'Energy timeline' });
  await expect(timeline.getByRole('button', { name: /18:00–19:00 UTC/ })).toContainText('1.00 kWh');

  await solar.focus();
  await solar.press('Enter');
  await expect(solar).toBeFocused();
  await expect(solar).toHaveAttribute('aria-pressed', 'true');
  await expect(solar).toContainText('Viewing');
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await expect(grid).not.toContainText('Viewing');
  await expect(details).toContainText('Utah solar example');
  await expect(details).toContainText('$0.00');
  await expect(timeline).toContainText('Utah solar example');
  await page.getByRole('heading', { name: 'Sunchaser', exact: true }).hover();
  await expect(details).toBeVisible();
  await expect(solar).toBeFocused();

  const closeDetails = basemap.getByRole('button', { name: 'Close details', exact: true });
  await closeDetails.focus();
  await closeDetails.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(solar).toBeFocused();

  await solar.press('Enter');
  await expect(details).toBeVisible();
  await closeDetails.click();
  await expect(details).toHaveCount(0);
  await expect(solar).toBeFocused();

  await solar.press('Enter');
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(solar).toBeFocused();

  await grid.click();
  await page.getByRole('button', { name: 'Route Fake job', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Job stream', exact: true }).getByRole('button', { name: 'Inspect job fake-job', exact: true })).toContainText('Selected');
  await expect(solar).toHaveAttribute('data-selected', 'true');
  const routePath = basemap.getByRole('img', { name: /^Job placement:/ }).locator('path.job-route[data-selected="true"]');
  await expect(routePath).toHaveAttribute('data-location-id', 'fake-utah-solar');
  await expect(routePath).toBeVisible();
  await expect(routePath).toHaveAttribute('data-origin-location-id', 'fake-utah-grid');
  await expect(basemap.locator('path.job-stay')).toHaveCount(0);
  await expect(routePath).toHaveClass(/route-reveal/);
  await expect(routePath).toHaveCSS('animation-name', 'reveal-route');
  await expect(routePath).toHaveCSS('animation-duration', '0.18s');
  const renderedAnchors = () => basemap.evaluate(element => {
    const origin = element.querySelector('.map-pin[data-origin="true"]')!.getBoundingClientRect();
    const destination = element.querySelector('.map-pin[data-selected="true"]')!.getBoundingClientRect();
    const route = element.querySelector('path.job-route[data-selected="true"]')!.getBoundingClientRect();
    return { originX: origin.x, originY: origin.y, destinationX: destination.x, destinationY: destination.y, pathX: route.x, pathY: route.y };
  });
  await page.keyboard.press('Escape');
  const beforePan = await renderedAnchors();
  await basemap.locator('.leaflet-container').focus();
  await basemap.locator('.leaflet-container').press('ArrowRight');
  await expect.poll(async () => Math.abs((await renderedAnchors()).originX - beforePan.originX)).toBeGreaterThan(20);
  await expect.poll(async () => {
    const after = await renderedAnchors();
    return Math.abs((after.pathX - beforePan.pathX) - (after.originX - beforePan.originX));
  }).toBeLessThan(2);
  await expect.poll(async () => {
    const after = await renderedAnchors();
    return Math.abs((after.pathY - beforePan.pathY) - (after.originY - beforePan.originY));
  }).toBeLessThan(2);
  await expect.poll(async () => {
    const after = await renderedAnchors();
    return Math.max(
      Math.abs((after.pathX - beforePan.pathX) - (after.destinationX - beforePan.destinationX)),
      Math.abs((after.pathY - beforePan.pathY) - (after.destinationY - beforePan.destinationY)),
    );
  }).toBeLessThan(2);
  await expect(map.getByRole('button', { name: 'Inspect Utah grid example', exact: true })).toHaveAttribute('data-origin', 'true');
  await expect(routePath).toHaveAttribute('data-location-id', 'fake-utah-solar');
  await expect(solar.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toBeVisible();
  await expect(solar).toHaveAttribute('aria-pressed', 'true');
  await expect(solar).toContainText('Selected for this job');
  await solar.hover();
  await expect(details).toContainText('Utah solar example');
  await expect(details).toContainText('Selected for this job');

  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toContainText('Viewing');
  await expect(details).toContainText('Utah grid example');
  await expect(solar).toHaveAttribute('data-selected', 'true');
  await expect(solar).toHaveAttribute('aria-pressed', 'false');
  await expect(solar).not.toContainText('Viewing');
  await basemap.locator('.leaflet-container').click({ position: { x: 80, y: 80 } });
  await expect(details).toHaveCount(0);
  const report = page.getByRole('region', { name: 'Job report', exact: true });
  await report.getByText('Report details', { exact: true }).click();
  await expect(report).toContainText('Selected location: Utah solar example');
});

test('keeps site inspection and timeline usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Energy sites' });
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await map.getByRole('button', { name: 'Inspect Utah solar example', exact: true }).click();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('$0.00');
  const slot = map.getByRole('region', { name: 'Energy timeline' }).getByRole('button');
  await slot.click();
  await expect(slot).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('preserves missing coordinates, stale evidence, and supplied source provenance', async ({ page }) => {
  const [grid, solar] = structuredClone(snapshots.sites);
  grid.snapshot.observedAt = '2026-10-27T17:54:00Z';
  solar.snapshot.simulated = false;
  solar.snapshot.source = 'fixture-live-site';
  await useFakeSnapshots(page, {
    ...snapshots, sites: [{ ...grid, latitude: undefined, longitude: undefined }, solar],
  });
  await page.goto('/');

  const map = page.getByRole('region', { name: 'Energy sites' });
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await map.getByRole('button', { name: 'Inspect Utah grid example', exact: true }).click();
  await expect(map.getByText('coordinates unavailable', { exact: false }).first()).toBeVisible();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('stale evidence');
  await expect(map.getByRole('region', { name: 'Energy timeline' }).getByRole('button')).toHaveAttribute('data-evidence', 'stale');
  await expect(map.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toHaveCount(0);

  const solarPin = map.getByRole('button', { name: 'Inspect Utah solar example', exact: true });
  await solarPin.click();
  await expect(solarPin).not.toContainText('Fake');
  await expect(solarPin).toContainText('source data');
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('source data');
});

test('every supplied same-site interval is available to inspect in the timeline', async ({ page }) => {
  const [grid, solar] = structuredClone(snapshots.sites);
  grid.snapshot.slot.window.endAt = '2026-10-27T18:30:00Z';
  grid.snapshot.slot.availableEnergyKWh = .5;
  const later = structuredClone(grid);
  later.snapshot.slot.id = 'fake-utah-grid-1830';
  later.snapshot.slot.window = { startAt: '2026-10-27T18:30:00Z', endAt: '2026-10-27T19:00:00Z' };
  later.snapshot.slot.availableEnergyKWh = .25;
  await useFakeSnapshots(page, { ...snapshots, sites: [grid, later, solar] });
  await page.goto('/');

  const map = page.getByRole('region', { name: 'Energy sites' });
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await map.getByRole('button', { name: 'Inspect Utah grid example', exact: true }).click();
  const timeline = map.getByRole('region', { name: 'Energy timeline' });
  await expect(timeline.getByRole('button')).toHaveCount(2);
  await expect(timeline.getByRole('button', { name: /18:00–18:30 UTC/ })).toContainText('0.50 kWh');
  await timeline.getByRole('button', { name: /18:30–19:00 UTC/ }).click();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('0.25 kWh');
});

test('reload returns to a ready Fake job with the same site energy and no routing selection', async ({ page }) => {
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Energy sites' });
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  const pins = map.getByRole('region', { name: 'US energy map' }).getByRole('button', { name: /^Inspect Utah/ });
  const solar = map.getByRole('button', { name: 'Inspect Utah solar example', exact: true });
  await expect(pins).toHaveCount(2);
  await expect(map.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toHaveCount(0);
  await map.getByRole('button', { name: 'Inspect Utah grid example', exact: true }).click();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('1.00 kWh');

  await page.getByRole('button', { name: 'Route Fake job', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Job stream', exact: true }).getByRole('button', { name: 'Inspect job fake-job', exact: true })).toContainText('Selected');
  await expect(solar).toHaveAttribute('data-selected', 'true');
  await expect(solar).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Route Fake job', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job stream', exact: true }).getByRole('button', { name: /^Inspect job / })).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Explore Utah sites', exact: true })).toHaveCount(0);
  await expect(pins).toHaveCount(1);
  await expect(map.getByRole('button', { name: 'Inspect Utah grid example', exact: true })).toHaveAttribute('data-origin', 'true');
  await expect(map.getByRole('button', { name: 'Inspect Utah grid example', exact: true }).getByRole('img', { name: 'Job request fake-job', exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await expect(pins).toHaveCount(2);
  await expect(solar).toHaveAttribute('data-selected', 'false');
  await expect(map.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toHaveCount(0);
  await map.getByRole('button', { name: 'Inspect Utah grid example', exact: true }).click();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('1.00 kWh');
  await solar.click();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('1.00 kWh');
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('$0.00');
});

test('site inspection still works when the basemap tiles cannot load', async ({ page }) => {
  await page.route(tileRequests, route => route.abort());
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Energy sites' });
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  await expect(map.getByText('Map tiles could not load', { exact: false })).toBeVisible();
  await map.getByRole('button', { name: 'Inspect Utah solar example', exact: true }).click();
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('Utah solar example');
  await expect(map.getByRole('region', { name: 'Site details' })).toContainText('$0.00');
});

test('shows a stay without a travel link when the supplied outcome keeps the job at its current site', async ({ page }) => {
  const grid = snapshots.sites.find(site => site.id === 'fake-utah-grid')!;
  const slot = grid.snapshot.slot;
  const outcome: JobOutcome = {
    selected: true,
    allocation: {
      jobId: 'fake-job', slot: { locationId: grid.id, slotId: slot.id }, slotVersion: grid.snapshot.version,
      allocatedGpus: 1, kWhPerGpuHour: 1, requiredPowerKW: 1,
      energy: [{ window: slot.window, estimatedKWh: 1 }], forecast: {},
      postedUsdPerGpuHour: slot.postedUsdPerGpuHour, priceBasis: slot.priceBasis,
    },
    explanation: 'Supplied same-site allocation for the map interaction; no execution.',
  };
  await page.route('**/src/core/scheduling/fakes/fakeRouter.ts*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function routeFakeJob() { return ' + JSON.stringify(outcome) + '; }',
  }));
  await page.goto('/');
  const basemap = page.getByRole('region', { name: 'US energy map' });
  const origin = basemap.getByRole('button', { name: 'Inspect Utah grid example', exact: true });
  await expect(origin).toHaveAttribute('data-origin', 'true');
  await expect(origin.getByRole('img', { name: 'Job request fake-job', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Route Fake job', exact: true }).click();
  const placement = basemap.getByRole('img', { name: /^Job placement:/ });
  const stayPath = placement.locator('path.job-stay[data-placement="stay"]');
  await expect(stayPath).toHaveCount(1);
  await expect(stayPath).toHaveAttribute('data-origin-location-id', 'fake-utah-grid');
  await expect(stayPath).toHaveAttribute('data-location-id', 'fake-utah-grid');
  await expect(stayPath).toBeVisible();
  await expect(stayPath).toHaveCSS('animation-name', 'confirm-placement');
  await expect(stayPath).toHaveCSS('animation-duration', '0.18s');
  await expect(placement.locator('path.job-route')).toHaveCount(0);
  await expect(origin).toHaveAttribute('data-origin', 'true');
  await expect(origin).toHaveAttribute('data-selected', 'true');
  await expect(origin).toContainText('Stays here');
  await expect(origin.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toBeVisible();
  await expect(basemap.getByRole('img', { name: 'Assigned job fake-job', exact: true })).toHaveCount(1);
  await expect(placement).toHaveAccessibleName('Job placement: fake-job stays at Utah grid example; execution not started');
});
