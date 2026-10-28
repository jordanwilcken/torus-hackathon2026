# Open-Meteo forecasts and saved replay

The live application collects seven forecast days for its six illustrative cities in one server-side request. It requests hourly average solar radiation, instantaneous radiation, temperature at 2 m and cloud cover. The existing browser `createSiteWeatherClient().subscribe(...)` receives the same feed envelope; the server refreshes at most every 30 minutes and archives a publication before exposing it.

These are provider model forecasts, not measured site weather or solar generation. `best_match` identifies Open-Meteo's model-selection mode, not a single named numerical model. The endpoint supplies no issue timestamp, so `issuedAt` is null and original retrieval time is the earliest evidenced availability in this application. Radiation remains W/m², temperature °C and cloud cover percent. Average radiation describes the preceding hour; instantaneous fields retain their own timestamp. Missing values and incomplete coverage remain explicit.

## Compose another selection

```ts
const selection: SiteWeatherSelection = {
  sites: [{ id: 'A', latitude: 40.7608, longitude: -111.891 }],
  forecastDays: 7,
  variables: ['shortwave_radiation', 'temperature_2m', 'cloud_cover'],
};
const archive = createSnapshotArchive<SiteWeatherSnapshot>(directory, 'weather-slc');
const feed = createSiteWeatherFeed(archive, { selection });
server.middlewares.use(createSiteWeatherApi(feed, archive));
```

Import the types from `src/data/SiteWeather.type.ts`, the collector from `src/server/siteWeather.ts`, the archive from `src/server/snapshotArchive.ts`, and HTTP adapter from `src/server/siteWeatherApi.ts`. A selection supports 1–12 unique site IDs, 1–7 days, and the four variables above; `shortwave_radiation` is required. Invalid selection fails before network/storage access. The application plugin also accepts `weatherSelection`; the current fleet consumer expects its A–F sites, so keep those when configuring that consumer. Distinct selections should use distinct stores. A feed never restores a mismatched selection as current data.

The existing `SnapshotStore<T>` publication contract is unchanged. History inspection uses the additional `SnapshotHistoryStore<T>.revisions()` capability; alternative storage implementations can supply it without changing collection or subscriptions. The file archive bounds history inspection to 512 publications and returns an explicit error above that limit. It does not delete stored publications. The history response lists the newest 20 with the total count; explicit revision reads remain available beyond the enumeration limit.

## Saved evidence API

- `GET /api/weather/sites`: current feed, including honest stale/unavailable status.
- `GET /api/weather/revisions`: saved revision identities, original retrieval times, coordinates, selection and provenance. Inspection does not contact Open-Meteo.
- `GET /api/weather/replay?at=<ISO-UTC>&revision=<SHA256>`: exact saved inputs, allowed only when retrieved by the decision time. Without a revision, chooses the latest eligible saved publication. If different selections exist, supply `selection=<selectionKey>` or an explicit revision; the service does not guess which coverage the decision used.
- `GET /api/weather/compare?earlier=<SHA256>&later=<SHA256>&site=A`: radiation differences for matching coordinates and common hourly intervals. Nulls remain null. This compares forecast revisions, not forecast skill against physical observations.

In the app, open **Open-Meteo → Forecast history** to inspect the saved curves and interval values. This reads the same API and archive used by replay. Existing fleet captures continue to pin their own full weather snapshot. Opening history does not change a running or saved scenario.

Legacy radiation-only publications remain readable without changing their revision. Their requested horizon is recovered from the archived source URL where present, otherwise reported as unknown. No historical weather/reanalysis product is added by this extension.

Provider semantics: [Open-Meteo forecast documentation](https://open-meteo.com/en/docs#hourly-parameter-definition).
