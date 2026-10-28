import { expect, test } from 'vitest';
import captured from '../../../fixtures/weather/open-meteo.json';
import { modeledSites } from '../../../../src/data/modeledSites';
import { parseSiteWeatherResponse } from '../../../../src/server/siteWeather';

// Unmodified public provider response captured once; CI never contacts the upstream service.
test('each modeled city receives its own captured radiation interval while Utah sites share only their grid region', () => {
  const snapshot = parseSiteWeatherResponse(captured.response, captured.retrievedAt);
  expect(snapshot.source).toBe('Open-Meteo');
  expect(snapshot.retrievedAt).toBe('2026-10-28T16:21:26.334Z');
  expect(snapshot.sites.map(site => site.locationId)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  expect(snapshot.sites[0]).toMatchObject({ locationId: 'A', latitude: 40.7608, longitude: -111.8910 });
  expect(snapshot.sites[1]).toMatchObject({ locationId: 'B', latitude: 37.6775, longitude: -113.0619 });
  expect(modeledSites.slice(0, 2).map(site => site.regionId)).toEqual(['PACE', 'PACE']);
  expect(snapshot.sites.map(site => site.intervals[16])).toEqual([254, 279, 124, 425, 350, 415].map(shortwaveRadiationWm2 => ({
    window: { startAt: '2026-10-28T15:00:00.000Z', endAt: '2026-10-28T16:00:00.000Z' }, shortwaveRadiationWm2,
  })));
  expect(snapshot.sites[0].intervals[0].window).toEqual({ startAt: '2026-10-27T23:00:00.000Z', endAt: '2026-10-28T00:00:00.000Z' });
});

test('a missing radiation forecast stays null and is distinct from a supplied nighttime zero', () => {
  const response = structuredClone(captured.response);
  (response[0].hourly.shortwave_radiation as Array<number | null>)[16] = null;
  response[0].hourly.shortwave_radiation[17] = 0;
  const site = parseSiteWeatherResponse(response, captured.retrievedAt).sites[0];
  expect(site.intervals[16].shortwaveRadiationWm2).toBeNull();
  expect(site.intervals[17].shortwaveRadiationWm2).toBe(0);
  expect(parseSiteWeatherResponse(captured.response, captured.retrievedAt).sites[0].intervals[16].shortwaveRadiationWm2).toBe(254);
});

test('missing or reordered locations cannot be assigned another city’s forecast', () => {
  expect(() => parseSiteWeatherResponse(captured.response.slice(1), captured.retrievedAt)).toThrow(/location/i);
  const swapped = structuredClone(captured.response);
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  expect(() => parseSiteWeatherResponse(swapped, captured.retrievedAt)).toThrow(/location/i);
});

test('unsupported units, local times, malformed hours and invalid radiation reject the publication', () => {
  const invalid = [
    (response: typeof captured.response) => { response[0].hourly_units.shortwave_radiation = 'kWh'; },
    (response: typeof captured.response) => { response[0].utc_offset_seconds = -21600; },
    (response: typeof captured.response) => { response[0].hourly.time[16] = '2026-10-28T16:30'; },
    (response: typeof captured.response) => { response[0].hourly.time[16] = response[0].hourly.time[15]; },
    (response: typeof captured.response) => { response[0].hourly.shortwave_radiation[16] = -1; },
    (response: typeof captured.response) => { response[0].hourly.shortwave_radiation.pop(); },
  ];
  for (const change of invalid) {
    const response = structuredClone(captured.response);
    change(response);
    expect(() => parseSiteWeatherResponse(response, captured.retrievedAt)).toThrow();
  }
});

test('a three-day response covers the last hour of a 24-hour model captured after 23:00 UTC', () => {
  // Extend only this boundary example with declared values; the committed public capture stays unmodified.
  const response = structuredClone(captured.response);
  for (const location of response) {
    for (let index = 48; index < 72; index++) {
      location.hourly.time.push(new Date(Date.parse('2026-10-28T00:00:00Z') + index * 3_600_000).toISOString().slice(0, 16));
      location.hourly.shortwave_radiation.push(321);
    }
  }
  const snapshot = parseSiteWeatherResponse(response, captured.retrievedAt);
  const horizonStart = Date.parse('2026-10-29T00:00:00Z');
  const horizonEnd = Date.parse('2026-10-30T00:00:00Z');
  const horizon = snapshot.sites[0].intervals.filter(interval => Date.parse(interval.window.startAt) >= horizonStart && Date.parse(interval.window.endAt) <= horizonEnd);
  expect(horizon).toHaveLength(24);
  expect(horizon.at(-1)).toEqual({ window: { startAt: '2026-10-29T23:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z' }, shortwaveRadiationWm2: 321 });
});
