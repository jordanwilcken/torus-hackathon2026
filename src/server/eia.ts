import { parseEiaApiResponse } from '../core/energy/data/eiaApi.ts';
import type { EiaApiSnapshot } from '../core/energy/data/eiaApi.ts';
import type { SourceEvidence } from './SnapshotStore.type.ts';
import { FeedError } from './cachedFeed.ts';

export async function collectEiaSnapshot(apiKey: string, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<EiaApiSnapshot> {
  return (await collectEiaPublication(apiKey, fetcher, now)).snapshot;
}

export async function collectEiaPublication(apiKey: string, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<{ snapshot: EiaApiSnapshot; evidence: SourceEvidence }> {
  if (!apiKey.trim()) throw new FeedError('Set EIA_API_KEY in the server environment.');
  const hour = 3_600_000;
  const at = Math.floor(now() / hour) * hour;
  const sourceUrl = 'https://api.eia.gov/v2/electricity/rto/region-data/data/';
  const url = new URL(sourceUrl);
  const parameters = {
    api_key: apiKey, frequency: 'hourly', 'data[0]': 'value', 'facets[respondent][]': 'PACE',
    start: new Date(at - 72 * hour).toISOString().slice(0, 13),
    end: new Date(at + 24 * hour).toISOString().slice(0, 13),
    'sort[0][column]': 'period', 'sort[0][direction]': 'desc', length: '5000',
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  let response: Response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(20_000) }); }
  catch { throw new FeedError('EIA could not be reached.'); }
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    const seconds = retry !== null && /^\d+$/.test(retry) ? Number(retry) : NaN;
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry ?? '') - now();
    throw new FeedError('EIA rate limited the request; retry is delayed.',
      Number.isFinite(delay) && delay >= 0 ? delay : 900_000);
  }
  if (!response.ok) throw new FeedError(`EIA returned HTTP ${response.status}.`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new FeedError('EIA returned an unreadable response.'); }
  try {
    const snapshot = parseEiaApiResponse(payload, new Date(now()).toISOString());
    // Whitelist only fields already accepted by the parser. EIA may echo credentials
    // in request metadata; never archive the request URL or the entire response root.
    const supplied = (payload as { response: Record<string, unknown> }).response;
    const fields = ['period', 'respondent', 'type', 'value', 'value-units'];
    const rows = (supplied.data as Record<string, unknown>[]).map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
    return { snapshot, evidence: { format: 'eia-response-v1', body: {
      sourceUrl, retrievedAt: snapshot.retrievedAt,
      query: { frequency: 'hourly', respondent: 'PACE', start: parameters.start, end: parameters.end, length: 5000, sort: 'period descending' },
      response: { frequency: supplied.frequency, dateFormat: supplied.dateFormat, total: supplied.total, data: rows },
    } } };
  } catch { throw new FeedError('EIA returned incomplete or unsupported regional data.'); }
}
