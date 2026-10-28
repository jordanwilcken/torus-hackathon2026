import { modeledSites } from '../data/modeledSites.ts';
import type { SiteWeatherSnapshot } from '../data/SiteWeather.type.ts';
import type { FeedState } from '../data/FeedState.type.ts';
import type { SnapshotStore, SourceEvidence } from './SnapshotStore.type.ts';
import { createCachedFeed, FeedError } from './cachedFeed.ts';
import { snapshotRevision } from './snapshotRevision.ts';

const hour = 3_600_000;
const refreshMs = 30 * 60_000;
const sourceUrl = 'https://api.open-meteo.com/v1/forecast';
export type SiteWeatherFeed = { read(): Promise<FeedState<SiteWeatherSnapshot>> };
export type SiteWeatherOptions = { fetcher?: typeof fetch; now?: () => number; offline?: boolean; recorded?: boolean };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Open-Meteo object');
  return value as Record<string, unknown>;
}

function hourEnding(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(value)) throw new Error('Invalid UTC forecast hour');
  const end = Date.parse(value + ':00Z');
  if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 16) !== value) throw new Error('Invalid UTC forecast hour');
  return end;
}

/** Radiation is a preceding-hour average, never instantaneous solar generation or site capacity.
 * Provider reference: https://open-meteo.com/en/docs#hourly-parameter-definition */
export function parseSiteWeatherResponse(payload: unknown, retrievedAt: string): SiteWeatherSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt)))
    throw new Error('Invalid weather retrieval time');
  if (!Array.isArray(payload) || payload.length !== modeledSites.length) throw new Error('Open-Meteo location count mismatch');
  const sites = modeledSites.map((site, index) => {
    const supplied = object(payload[index]);
    // Open-Meteo returns the selected weather grid cell, not the exact requested coordinates.
    // Keep the requested city coordinates and validate proximity/order; archive the original grid cell.
    if (typeof supplied.latitude !== 'number' || !Number.isFinite(supplied.latitude) ||
        typeof supplied.longitude !== 'number' || !Number.isFinite(supplied.longitude) ||
        Math.abs(supplied.latitude - site.latitude) > 0.25 || Math.abs(supplied.longitude - site.longitude) > 0.25 ||
        (supplied.location_id !== undefined && supplied.location_id !== index)) throw new Error('Open-Meteo location order mismatch');
    if (supplied.utc_offset_seconds !== 0) throw new Error('Open-Meteo must supply UTC forecasts');
    const units = object(supplied.hourly_units);
    if (units.time !== 'iso8601' || units.shortwave_radiation !== 'W/m²') throw new Error('Unsupported Open-Meteo units');
    const hourly = object(supplied.hourly);
    if (!Array.isArray(hourly.time) || !Array.isArray(hourly.shortwave_radiation) ||
        hourly.time.length === 0 || hourly.time.length > 72 || hourly.time.length !== hourly.shortwave_radiation.length)
      throw new Error('Incomplete Open-Meteo hourly arrays');
    const radiation = hourly.shortwave_radiation;
    let previous = -Infinity;
    const intervals = hourly.time.map((time, ordinal) => {
      const end = hourEnding(time);
      if (end <= previous) throw new Error('Open-Meteo forecast hours must be ordered and unique');
      previous = end;
      const value: unknown = radiation[ordinal];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
        throw new Error('Invalid shortwave radiation');
      return { window: { startAt: new Date(end - hour).toISOString(), endAt: new Date(end).toISOString() },
        shortwaveRadiationWm2: value as number | null };
    });
    return { locationId: site.id, latitude: site.latitude, longitude: site.longitude, intervals };
  });
  return { source: 'Open-Meteo', retrievedAt: new Date(retrievedAt).toISOString(), sites };
}

export async function collectSiteWeatherPublication(fetcher: typeof fetch = fetch, now: () => number = Date.now):
Promise<{ snapshot: SiteWeatherSnapshot; evidence: SourceEvidence }> {
  const url = new URL(sourceUrl);
  for (const [key, value] of Object.entries({
    latitude: modeledSites.map(site => site.latitude).join(','), longitude: modeledSites.map(site => site.longitude).join(','),
    hourly: 'shortwave_radiation', forecast_days: '3', timezone: 'UTC',
  })) url.searchParams.set(key, value);
  let response: Response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(20_000) }); }
  catch { throw new FeedError('Open-Meteo could not be reached.'); }
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? '') - now();
    throw new FeedError('Open-Meteo rate limited the request; retry is delayed.',
      Number.isFinite(delay) && delay > 0 ? delay : refreshMs);
  }
  if (!response.ok) throw new FeedError(`Open-Meteo returned HTTP ${response.status}.`);
  try {
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error('Weather response is too large');
    const payload: unknown = JSON.parse(text);
    const snapshot = parseSiteWeatherResponse(payload, new Date(now()).toISOString());
    return { snapshot, evidence: { format: 'open-meteo-response-v1', body: {
      sourceUrl: url.toString(), retrievedAt: snapshot.retrievedAt, response: payload,
    } } };
  } catch { throw new FeedError('Open-Meteo returned incomplete or unsupported site weather.'); }
}

/** Server cache and durable archive share one publication; an upstream failure cannot invent replacement weather. */
export function createSiteWeatherFeed(archive: SnapshotStore<SiteWeatherSnapshot>, options: SiteWeatherOptions = {}): SiteWeatherFeed {
  async function restored() {
    const record = await archive.latest();
    if (record && snapshotRevision(record.snapshot) !== record.revision) throw new Error('Weather archive revision mismatch');
    return record;
  }
  if (options.recorded) return { async read() {
    const record = await restored();
    return { status: record ? 'ready' : 'unavailable', snapshot: record?.snapshot ?? null,
      revision: record?.revision ?? null, lastAttemptAt: null, nextRefreshAt: null };
  } };
  return createCachedFeed(async () => {
    if (options.offline) throw new FeedError('Site weather is disabled in this offline server.');
    const collected = await collectSiteWeatherPublication(options.fetcher, options.now);
    try {
      if (await archive.save(collected.snapshot, collected.evidence) !== snapshotRevision(collected.snapshot))
        throw new Error('Weather archive revision mismatch');
    } catch { throw new FeedError('The site weather snapshot could not be saved; no new revision was published.'); }
    return collected.snapshot;
  }, refreshMs, options.now, options.offline ? undefined : async () => (await restored())?.snapshot ?? null,
  snapshot => Date.parse(snapshot.retrievedAt));
}
