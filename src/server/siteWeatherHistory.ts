import type { SiteWeatherSnapshot } from '../data/SiteWeather.type.ts';
import type { SnapshotHistoryStore, StoredSnapshot } from './SnapshotStore.type.ts';
import { snapshotRevision } from './snapshotRevision.ts';

export class WeatherHistoryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type Record = StoredSnapshot<SiteWeatherSnapshot>;
const fail = (status: number, message: string): never => { throw new WeatherHistoryError(status, message); };
export function weatherRevision(value: string | null): string {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return fail(400, 'A valid saved weather revision is required.');
  return value;
}
export function decisionTime(value: string | null): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return fail(400, 'Decision time must be an ISO UTC timestamp.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,19) !== value.slice(0,19)) return fail(400, 'Invalid decision time.');
  return time;
}
function verified(record: Record): Record {
  if (snapshotRevision(record.snapshot) !== record.revision || !Number.isFinite(Date.parse(record.snapshot.retrievedAt)))
    throw new Error('Invalid weather history publication');
  return record;
}
function summary(record: Record) {
  const { snapshot, revision } = record;
  const sites = snapshot.sites.map(({locationId, latitude, longitude}) => ({locationId, latitude, longitude}));
  // Legacy publications did not retain a selection. Recover only a documented
  // request horizon from their archived provider URL; absent evidence stays unknown.
  let legacyDays: number | null = null;
  const body = record.evidence.body as {sourceUrl?:unknown} | null;
  if (body && typeof body.sourceUrl === 'string') {
    try {
      const url = new URL(body.sourceUrl);
      const days = Number(url.searchParams.get('forecast_days'));
      if (url.origin === 'https://api.open-meteo.com' && url.pathname === '/v1/forecast' && Number.isInteger(days) && days >= 1 && days <= 7) legacyDays = days;
    } catch { /* An absent or unsupported request is not evidence of a horizon. */ }
  }
  const selection = snapshot.metadata?.selection ?? { sites: sites.map(({locationId, ...coordinates}) => ({id:locationId, ...coordinates})), forecastDays:legacyDays, variables:['shortwave_radiation'] };
  return { revision, retrievedAt:snapshot.retrievedAt, source:snapshot.source, sourceKind:'forecast' as const,
    model:'best_match' as const, issuedAt:null, sites, forecastDays:selection.forecastDays,
    selectionKey:snapshotRevision(selection), selection };
}

/** Queries immutable publications through the storage contract; no collection or refresh. */
export function createSiteWeatherHistory(store: SnapshotHistoryStore<SiteWeatherSnapshot>) {
  async function read(revision: string): Promise<Record> {
    const record = await store.read(weatherRevision(revision));
    if (!record) return fail(404, 'Saved weather revision was not found.');
    if (record.revision !== revision) throw new Error('Weather revision identity mismatch');
    return verified(record);
  }
  async function records() {
    const result: Record[] = [];
    for (const revision of await store.revisions()) result.push(await read(revision));
    return result.sort((a,b) => Date.parse(b.snapshot.retrievedAt)-Date.parse(a.snapshot.retrievedAt) || a.revision.localeCompare(b.revision));
  }
  return {
    async list() {
      const all = await records();
      return { revisions:all.slice(0,20).map(summary), total:all.length,
        basis:'Saved provider forecasts, ordered by original retrieval time. Model issue time is not supplied; retrieval is the earliest evidenced availability here.' };
    },
    async replay(at: number, revision?: string, selectionKey?: string) {
      let record: Record;
      if (revision) {
        record = await read(revision);
        if (Date.parse(record.snapshot.retrievedAt) > at) return fail(409, 'This forecast was retrieved after the decision time.');
        if (selectionKey && summary(record).selectionKey !== selectionKey) return fail(409, 'The revision belongs to a different weather selection.');
      } else {
        const candidates = (await records()).filter(entry => Date.parse(entry.snapshot.retrievedAt) <= at && (!selectionKey || summary(entry).selectionKey === selectionKey));
        if (!candidates.length) return fail(404, 'No saved forecast was available by this decision time.');
        if (new Set(candidates.map(entry => summary(entry).selectionKey)).size > 1)
          return fail(409, 'Multiple weather selections exist; choose a revision or selection key for replay.');
        record = candidates[0];
      }
      return { ...record, decisionAt:new Date(at).toISOString(), basis:'retrieved-by-decision-time',
        note:'Saved forecast inputs only. Original valid intervals are retained; this is not a historical observation or a live refresh.' };
    },
    async compare(earlierId: string, laterId: string, siteId: string) {
      if (!siteId || siteId.length > 64) return fail(400, 'A site identity is required.');
      const earlier = await read(earlierId);
      const later = await read(laterId);
      if (Date.parse(earlier.snapshot.retrievedAt) >= Date.parse(later.snapshot.retrievedAt))
        return fail(409, 'Choose two revisions in increasing retrieval-time order.');
      const first = earlier.snapshot.sites.find(site => site.locationId === siteId);
      const second = later.snapshot.sites.find(site => site.locationId === siteId);
      if (!first || !second) return fail(404, 'This site is not present in both revisions.');
      if (first.latitude !== second.latitude || first.longitude !== second.longitude) return fail(409, 'The site coordinates differ between revisions.');
      const key = (window: {startAt:string;endAt:string}) => window.startAt + '/' + window.endAt;
      const other = new Map(second.intervals.map(point => [key(point.window),point]));
      const points = first.intervals.flatMap(point => {
        const match = other.get(key(point.window));
        if (!match) return [];
        const a = point.shortwaveRadiationWm2;
        const b = match.shortwaveRadiationWm2;
        return [{window:point.window,earlier:a,later:b,change:a === null || b === null ? null : b-a}];
      });
      return { basis:'forecast-revision-change', unit:'W/m²', temporalBasis:'preceding-hour-average',
        earlier:{revision:earlier.revision,retrievedAt:earlier.snapshot.retrievedAt},
        later:{revision:later.revision,retrievedAt:later.snapshot.retrievedAt},
        site:{locationId:siteId,latitude:first.latitude,longitude:first.longitude},
        commonWindow:points.length ? {startAt:points[0].window.startAt,endAt:points.at(-1)!.window.endAt} : null,
        points, note:'Change between two model forecasts over matching intervals, not forecast accuracy against observations. Missing values remain missing.' };
    },
  };
}
