import { expect, test } from 'vitest';
import weatherCapture from '../../fixtures/weather/open-meteo.json';
import priceCapture from '../../fixtures/weather/caiso.json';
import { parseSiteWeatherResponse } from '../../../src/server/siteWeather';
import { snapshotRevision } from '../../../src/server/snapshotRevision';
import { captureLiveFleet, type FleetCaptureResult } from '../../../src/data/captureLiveFleet';
import type { FeedState } from '../../../src/data/FeedState.type';
import type { SiteWeatherSnapshot } from '../../../src/data/SiteWeather.type';
import { parseCaisoCsv, type CaisoSnapshot } from '../../../src/server/caiso';
import { createPairedReplaySession } from '../../../src/core/execution/replay/createPairedReplaySession';

const now = Date.parse('2026-10-28T16:26:19.000Z');
const originalWeather = parseSiteWeatherResponse(weatherCapture.response, weatherCapture.retrievedAt);
const originalPrice = parseCaisoCsv(priceCapture.evidence.body.csv, priceCapture.snapshot.retrievedAt);
function inputs() {
  const weather: FeedState<SiteWeatherSnapshot> = { status: 'ready', snapshot: structuredClone(originalWeather),
    revision: snapshotRevision(originalWeather), lastAttemptAt: weatherCapture.retrievedAt, nextRefreshAt: null };
  const market: FeedState<CaisoSnapshot> = { status: 'ready', snapshot: structuredClone(originalPrice),
    revision: priceCapture.revision, lastAttemptAt: priceCapture.snapshot.retrievedAt, nextRefreshAt: null };
  return { weather, market };
}
function captured(result: FleetCaptureResult) {
  expect(result.available).toBe(true);
  if (!result.available) throw new Error(result.reason);
  return result.capture;
}

test('the real weather and matching market capture produce distinct Utah inputs and an executable declared fleet model', () => {
  const { weather, market } = inputs();
  const capture = captured(captureLiveFleet(weather, market, now));
  expect(capture.capturedAt).toBe('2026-10-28T16:26:19.000Z');
  expect(capture.weatherRevision).toBe(weather.revision);
  expect(capture.priceRevision).toBe('7e55fed62e260bfd0cf7d94af18e965ffa2cb27263a632bcda8e4f3ffdb5c70f');
  expect(capture.price).toEqual({ window: { startAt: '2026-10-28T16:25:00.000Z', endAt: '2026-10-28T16:30:00.000Z' }, usdPerMWh: 22.26266 });
  expect(capture.scenario).toMatchObject({ startAt: '2026-10-28T17:00:00.000Z', hours: 24, routing: { policy: 'fleet' } });
  const [saltLake, cedarCity] = capture.scenario.sites;
  expect([saltLake.regionId, cedarCity.regionId]).toEqual(['PACE', 'PACE']);
  expect(saltLake).toMatchObject({ name: 'Salt Lake City', lat: 40.7608, lng: -111.891 });
  expect(cedarCity).toMatchObject({ name: 'Cedar City', lat: 37.6775, lng: -113.0619 });
  // The captured preceding-hour radiation is 518 and 586 W/m²; the declared 8 kW array and .8 ratio yield these modeled powers.
  expect(saltLake.forecast[0].supply?.solarKW).toBeCloseTo(3.3152, 10);
  expect(cedarCity.forecast[0].supply?.solarKW).toBeCloseTo(3.7504, 10);
  expect(saltLake.forecast[0].window).toEqual({ startAt: '2026-10-28T17:00:00.000Z', endAt: '2026-10-28T18:00:00.000Z' });
  expect(saltLake.forecast[0].accounting.gridUsdPerMWh).toBe(22.26266);
  expect(capture.scenario.label).toContain('modeled sites, jobs, execution and energy');
  expect(saltLake.configuration.accountingBasis).toContain('not physical site telemetry');
  const progress = createPairedReplaySession(capture.scenario).read();
  expect(progress).toMatchObject({ hour: 0, totalHours: 24, phase: 'ready' });
  expect([...progress.map.sites.keys()]).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
});

test('source forecast provenance stays projected and distinct from the explicitly modeled realization', () => {
  const { weather, market } = inputs();
  const capture = captured(captureLiveFleet(weather, market, now));
  const site = capture.scenario.sites[0];
  expect(site.forecast[0].evidence).toMatchObject({ observedAt: '2026-10-28T16:21:26.334Z', projected: true });
  expect(site.forecast[0].evidence.source).toContain('Open-Meteo radiation forecast');
  expect(site.forecast[0].evidence.source).toContain('declared 8 kW array');
  expect(site.observations[0].evidence.source).toContain('Modeled realization of captured forecast; no site meter');
  expect(site.observations[0].evidence.projected).toBe(false);
  expect(site.observations[0].evidence.version).not.toBe(site.forecast[0].evidence.version);
  expect(site.observations[0].supply).toBeDefined();
  site.observations[0].supply!.solarKW = 0;
  expect(site.forecast[0].supply?.solarKW).toBeCloseTo(3.3152, 10);
  expect(weather.snapshot!.sites[0].intervals[18].shortwaveRadiationWm2).toBe(518);
});

test('missing or stale weather cannot start a live-input model', () => {
  const { weather, market } = inputs();
  expect(captureLiveFleet({ ...weather, status: 'unavailable', snapshot: null, revision: null }, market, now))
    .toMatchObject({ available: false, reason: expect.stringMatching(/No substitute weather/) });
  expect(captureLiveFleet({ ...weather, status: 'stale' }, market, now)).toMatchObject({ available: false });
  weather.snapshot!.retrievedAt = '2026-10-28T14:26:18.000Z';
  expect(captureLiveFleet(weather, market, now)).toMatchObject({ available: false, reason: expect.stringMatching(/too old/) });
});

test('a null Salt Lake forecast hour cannot become zero solar or reuse Cedar City’s weather', () => {
  const { weather, market } = inputs();
  weather.snapshot!.sites[0].intervals[18].shortwaveRadiationWm2 = null;
  expect(captureLiveFleet(weather, market, now)).toMatchObject({ available: false,
    reason: expect.stringContaining('Missing forecast interval for Salt Lake City at 2026-10-28T17:00:00.000Z') });
});

test.each(['ready', 'stale'] as const)('missing, expired or unsupported negative market inputs cannot acquire an invented reference price (%s)', status => {
  const { weather, market } = inputs();
  expect(captureLiveFleet(weather, { ...market, status: 'unavailable', snapshot: null, revision: null }, now))
    .toMatchObject({ available: false, reason: expect.stringMatching(/No substitute price/) });
  market.status = status;
  market.snapshot!.prices = [{ window: { startAt: '2026-10-28T15:20:00.000Z', endAt: '2026-10-28T15:25:00.000Z' }, usdPerMWh: 20 }];
  expect(captureLiveFleet(weather, market, now)).toMatchObject({ available: false, reason: expect.stringMatching(/over one hour old/) });
  market.snapshot!.prices = [{ window: { startAt: '2026-10-28T16:25:00.000Z', endAt: '2026-10-28T16:30:00.000Z' }, usdPerMWh: -1 }];
  expect(captureLiveFleet(weather, market, now)).toMatchObject({ available: false, reason: expect.stringMatching(/negative/) });
});

test('a weather retrieval 30 seconds ahead of the browser cannot create a future-issued forecast at the model start', () => {
  const { weather, market } = inputs();
  weather.snapshot!.retrievedAt = '2026-10-28T17:00:30.000Z';
  weather.revision = snapshotRevision(weather.snapshot);
  const capture = captured(captureLiveFleet(weather, market, Date.parse('2026-10-28T17:00:00.000Z')));
  expect(capture.scenario.startAt).toBe('2026-10-28T18:00:00.000Z');
  expect(createPairedReplaySession(capture.scenario).read().phase).toBe('ready');
});

test('a failed CAISO refresh can use its recent real price without rewriting the retained evidence', async () => {
  const { weather, market } = inputs();
  market.status = 'stale';
  market.lastAttemptAt = '2026-10-28T16:26:19.000Z';
  market.nextRefreshAt = '2026-10-28T16:31:19.000Z';
  market.error = 'CAISO throttled this connection. Waiting before retrying.';
  const retained = structuredClone(market);

  const capture = captured(captureLiveFleet(weather, market, now));
  expect(capture.price).toEqual({
    window: { startAt: '2026-10-28T16:25:00.000Z', endAt: '2026-10-28T16:30:00.000Z' },
    usdPerMWh: 22.26266,
  });
  expect(capture.priceRevision).toBe('7e55fed62e260bfd0cf7d94af18e965ffa2cb27263a632bcda8e4f3ffdb5c70f');
  expect(capture.runInputs.caiso).toEqual({
    status: 'stale', revision: retained.revision, snapshot: retained.snapshot,
  });
  expect(capture.runInputs.caiso?.snapshot.retrievedAt).toBe('2026-10-28T16:26:18.023Z');
  expect(capture.runInputs.weather?.status).toBe('ready');
  expect(capture.scenario.sites[0].forecast[0].accounting.gridUsdPerMWh).toBe(22.26266);
  expect(market).toEqual(retained);

  const progress = await createPairedReplaySession(capture.scenario).step();
  expect(progress).toMatchObject({ hour: 1, phase: 'settled' });
  expect(progress.selected.run.ticks).toHaveLength(1);
  expect(progress.selected.run.ticks[0].executions.some(receipt => receipt.completedGpuH > 0)).toBe(true);
});

test('a retained stale CAISO price still expires one hour after its real source interval', () => {
  const { weather, market } = inputs();
  market.status = 'stale';
  const atLimit = captured(captureLiveFleet(weather, market, Date.parse('2026-10-28T17:30:00.000Z')));
  expect(atLimit.price.window.endAt).toBe('2026-10-28T16:30:00.000Z');
  expect(atLimit.runInputs.caiso?.status).toBe('stale');
  expect(captureLiveFleet(weather, market, Date.parse('2026-10-28T17:30:00.001Z')))
    .toMatchObject({ available: false, reason: expect.stringMatching(/over one hour old/) });
});
