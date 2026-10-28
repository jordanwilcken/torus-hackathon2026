import { expect, test, vi } from 'vitest';
import { collectSiteWeatherPublication, createSiteWeatherFeed, parseSiteWeatherResponse } from '../../../../src/server/siteWeather';
import type { SiteWeatherSnapshot } from '../../../../src/data/SiteWeather.type';
import type { SnapshotStore, StoredSnapshot } from '../../../../src/server/SnapshotStore.type';
import { snapshotRevision } from '../../../../src/server/snapshotRevision';

const retrievedAt = '2026-10-28T16:21:26.334Z';
const selection = {
  sites: [{ id: 'provo', latitude: 40.2338, longitude: -111.6585 }], forecastDays: 2,
  variables: ['shortwave_radiation', 'shortwave_radiation_instant', 'temperature_2m', 'cloud_cover'] as const,
};
// Deliberately small supplied provider values; this is contract evidence, not a live capture.
function provider() {
  return { latitude: 40.23, longitude: -111.66, utc_offset_seconds: 0,
    hourly_units: { time: 'iso8601', shortwave_radiation: 'W/m²', shortwave_radiation_instant: 'W/m²', temperature_2m: '°C', cloud_cover: '%' },
    hourly: { time: ['2026-10-28T16:00', '2026-10-28T17:00'], shortwave_radiation: [250, 400],
      shortwave_radiation_instant: [300, 440], temperature_2m: [12.5, 14], cloud_cover: [40, 25] } };
}
function store(): SnapshotStore<SiteWeatherSnapshot> {
  let latest: StoredSnapshot<SiteWeatherSnapshot> | null = null;
  return {
    async save(snapshot, evidence) { latest = structuredClone({ snapshot, evidence, revision: snapshotRevision(snapshot) }); return latest.revision; },
    async latest() { return structuredClone(latest); },
    async read(revision) { return latest?.revision === revision ? structuredClone(latest) : null; },
  };
}

test('a selected city keeps preceding-hour radiation separate from instantaneous weather and preserves forecast provenance', () => {
  const snapshot = parseSiteWeatherResponse(provider(), retrievedAt, { selection });
  expect(snapshot.sites[0]).toMatchObject({ locationId: 'provo', latitude: 40.2338, longitude: -111.6585 });
  expect(snapshot.sites[0].intervals[0]).toEqual({
    window: { startAt: '2026-10-28T15:00:00.000Z', endAt: '2026-10-28T16:00:00.000Z' }, shortwaveRadiationWm2: 250,
  });
  expect(snapshot.sites[0].instantaneous?.[0]).toEqual({ at: '2026-10-28T16:00:00.000Z',
    shortwaveRadiationInstantWm2: 300, temperatureC: 12.5, cloudCoverPercent: 40 });
  expect(snapshot.metadata).toMatchObject({ sourceKind: 'forecast', model: 'best_match', issuedAt: null,
    selection: { sites: selection.sites, forecastDays: 2, variables: [...selection.variables] },
    variables: { shortwave_radiation: { unit: 'W/m²', temporalBasis: 'preceding-hour-average' },
      temperature_2m: { unit: '°C', temporalBasis: 'instantaneous' } } });
});

test('invalid selected coordinates and duplicate city identities reject before a provider can be called', () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(() => createSiteWeatherFeed(store(), { fetcher, selection: { ...selection,
    sites: [{ id: 'a', latitude: 91, longitude: 0 }] } })).toThrow(/latitude/i);
  expect(() => createSiteWeatherFeed(store(), { fetcher, selection: { ...selection,
    sites: [{ id: 'a', latitude: 40, longitude: 0 }, { id: 'a', latitude: 41, longitude: 1 }] } })).toThrow(/unique/i);
  expect(fetcher).not.toHaveBeenCalled();
});

test('missing optional weather remains null with per-city coverage notes while true zero remains a value', () => {
  const supplied = provider();
  delete (supplied.hourly as Partial<typeof supplied.hourly>).temperature_2m;
  delete (supplied.hourly_units as Partial<typeof supplied.hourly_units>).temperature_2m;
  supplied.hourly.cloud_cover = [0];
  const site = parseSiteWeatherResponse(supplied, retrievedAt, { selection }).sites[0];
  expect(site.instantaneous?.map(point => point.temperatureC)).toEqual([null, null]);
  expect(site.instantaneous?.map(point => point.cloudCoverPercent)).toEqual([0, null]);
  expect(site.coverage?.find(metric => metric.variable === 'temperature_2m')).toMatchObject({
    status: 'unavailable', expectedHours: 48, availableHours: 0, missingHours: 48,
    notes: expect.arrayContaining([expect.stringContaining('Provider omitted temperature_2m')]),
  });
  expect(site.coverage?.find(metric => metric.variable === 'cloud_cover')).toMatchObject({
    status: 'partial', availableHours: 1, missingHours: 47,
  });
});

test('optional weather rejects incompatible units and invalid supplied values', () => {
  const wrongUnit = provider(); wrongUnit.hourly_units.temperature_2m = '°F';
  expect(() => parseSiteWeatherResponse(wrongUnit, retrievedAt, { selection })).toThrow(/units/i);
  const wrongCloud = provider(); wrongCloud.hourly.cloud_cover[0] = 101;
  expect(() => parseSiteWeatherResponse(wrongCloud, retrievedAt, { selection })).toThrow(/cloud_cover/i);
  const wrongInstant = provider(); wrongInstant.hourly.shortwave_radiation_instant[0] = -1;
  expect(() => parseSiteWeatherResponse(wrongInstant, retrievedAt, { selection })).toThrow(/shortwave_radiation_instant/i);
});

test('site count, longitude, forecast horizon and variable bounds are checked before collection', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const invalid = [
    { ...selection, sites: [] },
    { ...selection, sites: Array.from({ length: 13 }, (_, index) => ({ id: `city-${index}`, latitude: 0, longitude: 0 })) },
    { ...selection, sites: [{ id: 'a', latitude: 0, longitude: -181 }] },
    { ...selection, forecastDays: 0 }, { ...selection, forecastDays: 8 }, { ...selection, forecastDays: 1.5 },
    { ...selection, variables: [] },
    { ...selection, variables: ['shortwave_radiation', 'shortwave_radiation'] as const },
  ];
  for (const requested of invalid) {
    await expect(collectSiteWeatherPublication(fetcher, () => Date.parse(retrievedAt), { selection: requested })).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

test('collection uses a detached selection and stores the exact request with its original provider evidence', async () => {
  const selected = { ...selection, sites: selection.sites.map(site => ({ ...site })), variables: [...selection.variables] };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(provider()));
  const archive = store();
  const feed = createSiteWeatherFeed(archive, { selection: selected, fetcher, now: () => Date.parse(retrievedAt) });
  selected.sites[0].latitude = 0; selected.variables.pop(); selected.forecastDays = 7;
  const publication = await feed.read();
  expect(publication.status).toBe('ready');
  expect(publication.snapshot?.metadata?.selection).toEqual({ sites: selection.sites, forecastDays: 2, variables: [...selection.variables] });
  const request = new URL(String(fetcher.mock.calls[0][0]));
  expect(Object.fromEntries(request.searchParams)).toEqual({ latitude: '40.2338', longitude: '-111.6585',
    hourly: 'shortwave_radiation,shortwave_radiation_instant,temperature_2m,cloud_cover', forecast_days: '2', timezone: 'UTC', models: 'best_match' });
  expect((await archive.latest())?.evidence.body).toEqual({ sourceUrl: request.toString(), retrievedAt, response: provider(),
    selection: { sites: selection.sites, forecastDays: 2, variables: [...selection.variables] } });
});

test('a feed never restores another selection’s recent publication', async () => {
  const archive = store();
  const now = () => Date.parse(retrievedAt);
  await createSiteWeatherFeed(archive, { selection, fetcher: async () => Response.json(provider()), now }).read();
  const changed = { ...selection, sites: [{ id: 'ogden', latitude: 41.223, longitude: -111.9738 }] };
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('Upstream unavailable'); });
  const other = await createSiteWeatherFeed(archive, { selection: changed, fetcher, now }).read();
  expect(other).toMatchObject({ status: 'unavailable', snapshot: null, revision: null });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(await createSiteWeatherFeed(archive, { selection: changed, recorded: true }).read())
    .toMatchObject({ status: 'unavailable', snapshot: null, revision: null });
  const sameFetcher = vi.fn<typeof fetch>();
  expect(await createSiteWeatherFeed(archive, { selection, fetcher: sameFetcher, now }).read())
    .toMatchObject({ status: 'ready', snapshot: { sites: [{ locationId: 'provo' }] } });
  expect(sameFetcher).not.toHaveBeenCalled();
});

test('a selected seven-day horizon accepts all 168 hours without changing the average-radiation interval shape', () => {
  const supplied = provider();
  supplied.hourly.time = Array.from({ length: 168 }, (_, index) => new Date(Date.parse('2026-10-28T00:00:00Z') + index * 3_600_000).toISOString().slice(0, 16));
  supplied.hourly.shortwave_radiation = Array.from({ length: 168 }, () => 0);
  const snapshot = parseSiteWeatherResponse(supplied, retrievedAt, { selection: { ...selection, forecastDays: 7, variables: ['shortwave_radiation'] } });
  expect(snapshot.sites[0].intervals).toHaveLength(168);
  expect(snapshot.sites[0].intervals.at(-1)).toEqual({ window: {
    startAt: '2026-11-03T22:00:00.000Z', endAt: '2026-11-03T23:00:00.000Z' }, shortwaveRadiationWm2: 0 });
  expect(snapshot.sites[0].coverage).toEqual([{ variable: 'shortwave_radiation', status: 'complete', expectedHours: 168,
    availableHours: 168, missingHours: 0, notes: [] }]);
});
