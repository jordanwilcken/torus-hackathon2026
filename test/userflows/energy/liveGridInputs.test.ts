import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { EiaApiSnapshot } from '../../../src/core/energy/data/eiaApi';
import type { CaisoSnapshot } from '../../../src/server/caiso';
import type { FeedState } from '../../../src/server/cachedFeed';

const observedWindow = { startAt: '2026-10-28T05:00:00.000Z', endAt: '2026-10-28T06:00:00.000Z' };

function eiaSnapshot(retrievedAt = '2026-10-28T07:15:00.000Z'): EiaApiSnapshot {
  const source = `EIA-930 PACE API; retrieved ${retrievedAt}`;
  return {
    source, sourceUrl: 'https://api.eia.gov/v2/electricity/rto/region-data/data/', retrievedAt, regionId: 'PACE',
    observations: [
      { metric: 'demand', value: 5000 }, { metric: 'generation', value: 4500 }, { metric: 'interchange', value: -500 },
    ].map(item => ({ ...item, metric: item.metric as 'demand' | 'generation' | 'interchange', regionId: 'PACE', unit: 'MW', window: observedWindow, observedAt: observedWindow.endAt, source, basis: 'Reported hourly MWh expressed as average MW', simulated: false })),
    forecast: { demand: {
      source, scope: 'PACE', basis: 'Reported day-ahead demand forecast', unit: 'MW', retrievedAt, simulated: false,
      points: [{ window: { startAt: '2026-10-29T05:00:00.000Z', endAt: '2026-10-29T06:00:00.000Z' }, value: 5100 }],
    } },
  };
}

function caisoSnapshot(): CaisoSnapshot {
  return {
    source: 'CAISO OASIS provisional wholesale market price', sourceUrl: 'https://oasis.caiso.com/',
    retrievedAt: '2026-10-28T07:26:00.000Z', node: 'ELAP_PACE-APND',
    prices: [
      { window: { startAt: '2026-10-28T07:20:00.000Z', endAt: '2026-10-28T07:25:00.000Z' }, usdPerMWh: 38.42 },
      { window: { startAt: '2026-10-28T07:35:00.000Z', endAt: '2026-10-28T07:40:00.000Z' }, usdPerMWh: 99.99 },
    ],
  };
}

function ready<T extends { retrievedAt: string }>(snapshot: T): FeedState<T> {
  return { status: 'ready', snapshot, revision: snapshot.retrievedAt, lastAttemptAt: snapshot.retrievedAt, nextRefreshAt: '2026-10-28T07:31:00.000Z' };
}

async function prepareBrowser(page: Page, at = '2026-10-28T07:30:00.000Z') {
  await page.clock.install({ time: new Date(Date.parse(at) - 60_000) });
  await page.clock.pauseAt(new Date(at));
  await page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/></svg>',
  }));
}

async function readings(page: Page) {
  await page.getByRole('button', { name: 'EIA source', exact: true }).click();
  await page.getByText('Detailed grid evidence', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Live regional inputs', exact: true });
  return {
    panel,
    eia: panel.getByRole('region', { name: 'EIA regional observations', exact: true }),
    caiso: panel.getByRole('region', { name: 'CAISO wholesale prices', exact: true }),
  };
}

test('shows supplied regional actuals, a distinct demand forecast and provisional wholesale prices on the default page', async ({ page }) => {
  await prepareBrowser(page);
  await page.route('**/api/grid/eia', route => route.fulfill({ json: ready(eiaSnapshot()) }));
  await page.route('**/api/grid/caiso', route => route.fulfill({ json: ready(caisoSnapshot()) }));
  await page.goto('/');
  const { panel, eia, caiso } = await readings(page);

  await expect(panel).toContainText('PacifiCorp East · Utah regional context');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('5,000 MW');
  await expect(eia.getByRole('row', { name: /Net generation/ })).toContainText('4,500 MW');
  await expect(eia.getByRole('row', { name: /Net interchange/ })).toContainText('-500 MW');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('2026-10-28 05:00–06:00 UTC');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('1 h 30 min old');
  await expect(eia.getByRole('region', { name: 'Day-ahead demand forecast' })).toContainText('5,100 MW');
  await expect(eia.getByRole('region', { name: 'Day-ahead demand forecast' })).toContainText('2026-10-29 05:00–06:00 UTC');
  await expect(eia).toContainText('Carbon intensity unavailable in this API connection');
  await expect(eia.locator('time[datetime="2026-10-28T07:15:00.000Z"]')).toBeVisible();
  await expect(eia.getByRole('link', { name: 'EIA-930 source' })).toHaveAttribute('href', 'https://api.eia.gov/v2/electricity/rto/region-data/data/');
  await expect(caiso).toContainText('$38.42 / MWh');
  await expect(caiso).not.toContainText('$99.99 / MWh');
  await expect(caiso).toContainText('2026-10-28 07:20–07:25 UTC');
  await expect(caiso).toContainText('Provisional wholesale price');
  await expect(caiso).toContainText('Retail bill unavailable');
  await expect(panel).not.toContainText('Fake');
});

test('marks old source intervals as delayed even after a successful request while another feed is unavailable', async ({ page }) => {
  await prepareBrowser(page, '2026-10-28T10:00:00.000Z');
  await page.route('**/api/grid/eia', route => route.fulfill({ json: ready(eiaSnapshot('2026-10-28T09:58:00.000Z')) }));
  await page.route('**/api/grid/caiso', route => route.fulfill({ json: {
    status: 'unavailable', snapshot: null, revision: null, lastAttemptAt: '2026-10-28T10:00:00.000Z', nextRefreshAt: null, error: 'CAISO request unavailable.',
  } }));
  await page.goto('/');
  const { eia, caiso } = await readings(page);

  await expect(eia).toContainText('Request succeeded');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('5,000 MW');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('Delayed · 4 h old');
  await expect(eia.locator('time[datetime="2026-10-28T09:58:00.000Z"]')).toBeVisible();
  await expect(caiso).toContainText('Unavailable');
  await expect(caiso).not.toContainText('$0.00');
});

test('retains the last successful readings and original retrieval times after independent refresh failures', async ({ page }) => {
  await prepareBrowser(page);
  let failRefresh = false;
  let failedEiaRequests = 0;
  let failedCaisoRequests = 0;
  await page.route('**/api/grid/eia', route => {
    if (failRefresh) { failedEiaRequests++; return route.fulfill({ status: 503, body: 'Unavailable' }); }
    return route.fulfill({ json: ready(eiaSnapshot()) });
  });
  await page.route('**/api/grid/caiso', route => {
    if (failRefresh) { failedCaisoRequests++; return route.fulfill({ status: 503, body: 'Unavailable' }); }
    return route.fulfill({ json: ready(caisoSnapshot()) });
  });
  await page.goto('/');
  const { eia, caiso } = await readings(page);
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('5,000 MW');
  await expect(caiso).toContainText('$38.42 / MWh');

  failRefresh = true;
  await page.clock.runFor(60_000);
  await expect(eia).toContainText('Refresh failed · showing last successful data');
  await expect(caiso).toContainText('Refresh failed · showing last successful data');
  expect(failedEiaRequests).toBeGreaterThan(0);
  expect(failedCaisoRequests).toBeGreaterThan(0);
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('5,000 MW');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('1 h 31 min old');
  await expect(eia.getByRole('row', { name: /Regional demand/ })).toContainText('2026-10-28 05:00–06:00 UTC');
  await expect(eia.locator('time[datetime="2026-10-28T07:15:00.000Z"]')).toBeVisible();
  await expect(caiso).toContainText('$38.42 / MWh');
  await expect(caiso.locator('time[datetime="2026-10-28T07:26:00.000Z"]')).toBeVisible();
});
