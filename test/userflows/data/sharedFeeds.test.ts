import { expect, test } from '@playwright/test';

const window = { startAt: '2026-10-28T05:00:00.000Z', endAt: '2026-10-28T06:00:00.000Z' };
function publication(value: number, revision: string, retrievedAt: string) {
  return { status: 'ready', revision, lastAttemptAt: retrievedAt, nextRefreshAt: null, snapshot: {
    source: 'EIA-930 PACE', sourceUrl: 'https://api.eia.gov/', regionId: 'PACE', retrievedAt, forecast: {},
    observations: [{ regionId: 'PACE', metric: 'demand', value, unit: 'MW', window, observedAt: window.endAt,
      source: 'EIA-930 PACE', basis: 'Hourly average', simulated: false }],
  } };
}

test('two standalone consumers share published revisions and retain dated evidence after failure', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-28T07:29:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T07:30:00Z'));
  let result = publication(5000, 'eia-one', '2026-10-28T07:15:00Z');
  let failure = false;
  let requests = 0;
  await page.route('**/api/grid/eia', route => {
    requests++;
    return failure ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({ json: result });
  });
  await page.goto('/test/userflows/data/fixture.html');
  const snapshotReader = page.getByRole('region', { name: 'Snapshot reader', exact: true });
  const providerReader = page.getByRole('region', { name: 'Regional provider reader', exact: true });
  for (const reader of [snapshotReader, providerReader]) {
    await expect(reader).toContainText('5000 MW');
    await expect(reader).toHaveAttribute('data-revision', 'eia-one');
  }
  expect(requests).toBe(1);

  result = publication(5100, 'eia-two', '2026-10-28T07:30:00Z');
  await page.clock.runFor(60_000);
  for (const reader of [snapshotReader, providerReader]) {
    await expect(reader).toContainText('5100 MW');
    await expect(reader).toHaveAttribute('data-revision', 'eia-two');
    await expect(reader).toContainText('Retrieved 2026-10-28T07:30:00Z');
  }
  expect(requests).toBe(2);

  failure = true;
  await page.clock.runFor(60_000);
  for (const reader of [snapshotReader, providerReader]) {
    await expect(reader).toContainText('stale');
    await expect(reader).toContainText('5100 MW');
    await expect(reader).toHaveAttribute('data-revision', 'eia-two');
    await expect(reader).toContainText('Retrieved 2026-10-28T07:30:00Z');
    await expect(reader).toContainText('Interval ends 2026-10-28T06:00:00.000Z');
  }
  expect(requests).toBe(3);
});
