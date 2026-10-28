import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1ea"/><path d="M0 90h256M80 0v256" stroke="#cdd9ce" stroke-width="2"/></svg>',
  }));
});

async function openMap(page: Page) {
  await page.goto('/test/userflows/scheduling/posted-price.html');
  const map = page.getByRole('region', { name: 'US energy map', exact: true });
  await expect(map).toBeVisible();
  await expect(map.locator('path.map-comet')).toHaveCount(0);
  return map;
}

async function utahMap(page: Page) {
  const map = await openMap(page);
  await map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
  return map;
}

function priceDetails(map: Locator) {
  return map.getByRole('region', { name: 'Price details', exact: true });
}

test('[COMPACT-01] shows small inspectable US pins without persistent label cards', async ({ page }) => {
  const map = await openMap(page);
  await map.getByRole('button', { name: 'Show US', exact: true }).click();
  const pins = map.getByRole('button', { name: /^Inspect (?:.* region|Lehi|Provo)$/ });
  await expect(pins).toHaveCount(7);
  for (const pin of await pins.all()) {
    const bounds = await pin.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(40);
    expect(bounds!.height).toBeLessThanOrEqual(40);
    await expect(pin).toBeEnabled();
  }
  for (const caption of await map.locator('.map-pin > strong, .map-pin > span:not(.job-assignment), .map-pin > small').all())
    await expect(caption).toBeHidden();
});

test('[COMPACT-02] compact site pins still open their price information by click and keyboard', async ({ page }) => {
  const map = await utahMap(page);
  await map.getByRole('button', { name: 'Inspect Lehi', exact: true }).click();
  await expect(priceDetails(map)).toBeVisible();
  await expect(priceDetails(map).getByRole('heading', { level: 3 })).toContainText('Lehi');
  await expect(priceDetails(map).getByText('$0.075', { exact: false }).first()).toBeVisible();

  const provo = map.getByRole('button', { name: 'Inspect Provo', exact: true });
  await provo.focus();
  await page.keyboard.press('Enter');
  await expect(priceDetails(map).getByRole('heading', { level: 3 })).toContainText('Provo');
  await expect(priceDetails(map).getByText('$0.09', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Lehi');
});

test('[COMPACT-03] one supplied routing event draws a transient comet whose tail disappears and inspection does not replay it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const map = await utahMap(page);
  await expect(map.locator('path.map-comet')).toHaveCount(0);
  const supplied = await page.evaluate(() => window.pricePreview.read());
  await page.getByRole('button', { name: 'Replay sample route', exact: true }).click();
  const head = map.locator('path.map-comet-head');
  const tail = map.locator('path.map-comet-tail');
  await expect(head).toBeVisible();
  await expect(tail).toBeVisible();
  await expect(map.locator('path.map-comet')).toHaveCount(3);
  const animationName = await head.evaluate(element => new Promise<string>(resolve => {
    element.addEventListener('animationend', event => resolve((event as AnimationEvent).animationName), { once: true });
  }));
  expect(animationName).toBe('map-shooting-star');
  await expect(map.locator('path.map-comet')).toHaveCount(0);
  await expect(map.locator('path.job-route')).toBeHidden();

  await page.getByRole('region', { name: 'Lehi prices', exact: true })
    .getByRole('button', { name: /^Inspect Lehi, 13:00 UTC,/ }).click();
  await expect(priceDetails(map).getByText('$0.045', { exact: false }).first()).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(map.locator('path.map-comet')).toHaveCount(0);
  expect(await page.evaluate(() => window.pricePreview.read())).toEqual(supplied);
});

test('[COMPACT-04] waiting and stale outcomes cannot replay a routing event or animate a claimed selection', async ({ page }) => {
  const map = await openMap(page);
  const replay = page.getByRole('button', { name: 'Replay sample route', exact: true });
  for (const scene of ['waiting', 'stale'] as const) {
    await page.evaluate(scene => window.pricePreview.show(scene), scene);
    await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('No slot selected');
    await expect(replay).toBeDisabled();
    await expect(map.locator('path.map-comet')).toHaveCount(0);
    await expect(map.getByRole('img', { name: /^Assigned job / })).toHaveCount(0);
  }
});

test('[COMPACT-05] reduced motion preserves the selected site without a comet or pulse animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const map = await utahMap(page);
  await page.getByRole('button', { name: 'Replay sample route', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Selected · not executed');
  await expect(page.getByRole('region', { name: 'Lehi prices', exact: true }).getByText('Selected', { exact: true })).toBeVisible();
  await expect(map.getByRole('img', { name: /^Assigned job / })).toHaveCount(1);
  await expect(map.locator('path.map-comet')).toHaveCount(0);
  const motion = await map.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running')
    .map(animation => animation instanceof CSSAnimation ? animation.animationName : '')
    .filter(name => name === 'map-site-pulse' || name === 'map-shooting-star'));
  expect(motion).toEqual([]);
});

test('[COMPACT-06] bottom forecasts show supplied current and future carbon evidence for the inspected site and keep missing forecasts unknown', async ({ page }) => {
  const map = await utahMap(page);
  const lehi = page.getByRole('region', { name: 'Lehi forecast', exact: true });
  await expect(lehi).toBeVisible();
  await expect(lehi.getByText('Carbon · gCO2/kWh', { exact: true })).toBeVisible();
  await expect(lehi.getByRole('button', { name: 'Inspect Lehi carbon forecast, 12:00 UTC, 28 Oct 2026', exact: true })).toContainText('300');
  await expect(lehi.getByRole('button', { name: 'Inspect Lehi carbon forecast, 13:00 UTC, 28 Oct 2026', exact: true })).toContainText('200');
  await expect(lehi.locator('details')).toHaveJSProperty('open', false);
  await expect(lehi.getByText('illustrative-carbon-model', { exact: false }).first()).toBeHidden();
  await lehi.getByText('Forecast sources', { exact: true }).click();
  await expect(lehi.getByText('illustrative-carbon-model', { exact: false }).first()).toBeVisible();
  await expect(lehi).toContainText('Issued');
  await expect(lehi).toContainText('Retrieved');

  await map.getByRole('button', { name: 'Inspect Provo', exact: true }).click();
  const provo = page.getByRole('region', { name: 'Provo forecast', exact: true });
  await expect(provo).toBeVisible();
  await expect(provo.getByRole('button', { name: 'Inspect Provo carbon forecast, 13:00 UTC, 28 Oct 2026', exact: true })).toContainText('200');
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Lehi');

  await page.evaluate(() => window.pricePreview.show('no-forecast'));
  const unknown = page.getByRole('region', { name: 'Lehi forecast', exact: true });
  await expect(unknown).toContainText(/No forecast supplied|Forecast unavailable/i);
  await expect(unknown.getByRole('button', { name: /forecast,/ })).toHaveCount(0);
  await expect(unknown).not.toContainText(/\b300\b|\b200\b/);
});

test('[COMPACT-07] returning to a previously displayed job event does not replay its route after another job', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const map = await utahMap(page);
  await expect(map.locator('path.map-comet')).toHaveCount(0);

  await page.evaluate(() => window.pricePreview.show('job-b'));
  const head = map.locator('path.map-comet-head');
  await expect(head).toBeVisible();
  await expect(map.getByRole('img', { name: 'Assigned job training-batch-b', exact: true })).toHaveCount(1);
  const animationName = await head.evaluate(element => new Promise<string>(resolve => {
    element.addEventListener('animationend', event => resolve((event as AnimationEvent).animationName), { once: true });
  }));
  expect(animationName).toBe('map-shooting-star');
  await expect(map.locator('path.map-comet')).toHaveCount(0);

  await page.evaluate(() => window.pricePreview.show('selected'));
  await expect(map.getByRole('img', { name: 'Assigned job training-batch', exact: true })).toHaveCount(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // Observe immediately after rendering; polling for zero could hide a wrongly replayed comet that later finishes.
  expect(await map.locator('path.map-comet-head').count()).toBe(0);
  expect(await map.locator('path.map-comet').count()).toBe(0);
  await expect(page.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Selected · not executed');
});

test('[COMPACT-08] equivalent ISO timestamp spellings retain supplied forecast values for the same interval', async ({ page }) => {
  await utahMap(page);
  await page.evaluate(() => window.pricePreview.show('normalized-forecast'));
  const forecast = page.getByRole('region', { name: 'Lehi forecast', exact: true });
  await expect(forecast).toBeVisible();
  await expect(forecast.getByRole('button', { name: /^Inspect Lehi carbon forecast, 12:00 UTC(?:,.*)?$/ })).toContainText('300');
  await expect(forecast.getByRole('button', { name: /^Inspect Lehi carbon forecast, 13:00 UTC(?:,.*)?$/ })).toContainText('200');
  await expect(forecast.getByText('Carbon · gCO2/kWh', { exact: true })).toBeVisible();
});

test('[COMPACT-09] forecast hours on different days have distinct accessible names and visible dates', async ({ page }) => {
  await utahMap(page);
  await page.evaluate(() => window.pricePreview.show('overnight'));
  const forecast = page.getByRole('region', { name: 'Lehi forecast', exact: true });
  const day28 = forecast.getByRole('button', { name: /^Inspect Lehi carbon forecast, 12:00 UTC,.*28 Oct 2026/ });
  const day29 = forecast.getByRole('button', { name: /^Inspect Lehi carbon forecast, 12:00 UTC,.*29 Oct 2026/ });
  await expect(day28).toHaveCount(1);
  await expect(day29).toHaveCount(1);
  await expect(day28).toContainText('300');
  await expect(day29).toContainText('200');
  await expect(forecast.getByText('28 Oct 2026', { exact: false }).first()).toBeVisible();
  await expect(forecast.getByText('29 Oct 2026', { exact: false }).first()).toBeVisible();
});

test('[COMPACT-10] the clicked site keeps its bottom forecast when its map popup closes or forecast sources are opened', async ({ page }) => {
  const map = await utahMap(page);
  await map.getByRole('button', { name: 'Inspect Provo', exact: true }).click();
  await expect(priceDetails(map).getByRole('heading', { level: 3 })).toContainText('Provo');
  const forecast = page.getByRole('region', { name: 'Provo forecast', exact: true });
  await expect(forecast).toBeVisible();

  await map.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(priceDetails(map)).toHaveCount(0);
  await expect(forecast).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lehi forecast', exact: true })).toHaveCount(0);
  await forecast.getByText('Forecast sources', { exact: true }).click();
  await expect(forecast.locator('details')).toHaveJSProperty('open', true);
  await expect(forecast.getByText('illustrative-carbon-model', { exact: false }).first()).toBeVisible();
  await expect(forecast.getByRole('button', { name: 'Inspect Provo carbon forecast, 13:00 UTC, 28 Oct 2026', exact: true })).toContainText('200');
  const job = page.getByRole('region', { name: 'Job choice', exact: true });
  await expect(job).toContainText('Lehi');
  await expect(job.getByText('$0.075', { exact: false }).first()).toBeVisible();
});

test('[COMPACT-11] resizing then dismissing site popups leaves no queued observer errors and preserves usable forecasts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const map = await utahMap(page);
  for (const [cycle, site] of ['Provo', 'Lehi', 'Provo', 'Lehi'].entries()) {
    const currentSources = page.getByRole('region', { name: /^(?:Lehi|Provo) forecast$/ }).locator('details');
    if (await currentSources.evaluate((element: HTMLDetailsElement) => element.open))
      await currentSources.locator('summary').click();

    await map.getByRole('button', { name: `Inspect ${site}`, exact: true }).click();
    const popup = priceDetails(map);
    await expect(popup.getByRole('heading', { level: 3 })).toContainText(site);
    await popup.getByText('Price evidence', { exact: true }).click();
    const forecast = page.getByRole('region', { name: `${site} forecast`, exact: true });
    await forecast.getByText('Forecast sources', { exact: true }).click();
    await expect(popup).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    await expect(map).toBeVisible();
    await expect(forecast).toBeVisible();
    await expect(forecast.getByText('illustrative-carbon-model', { exact: false }).first()).toBeVisible();
    await expect(forecast.getByRole('button', { name: new RegExp(`^Inspect ${site} carbon forecast, 13:00 UTC,`) })).toContainText('200');
    expect(errors, `Popup resize/dismiss cycle ${cycle + 1}`).toEqual([]);
  }

  await map.getByRole('button', { name: 'Inspect Provo', exact: true }).click();
  await priceDetails(map).getByText('Price evidence', { exact: true }).click();
  await map.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(priceDetails(map)).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(map).toBeVisible();
  await expect(page.getByRole('region', { name: 'Provo forecast', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
