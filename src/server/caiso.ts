import { strFromU8, unzipSync } from 'fflate';
import { FeedError } from './cachedFeed.ts';
import type { SourceEvidence } from './snapshotArchive.ts';

export type CaisoSnapshot = {
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  node: 'ELAP_PACE-APND';
  prices: Array<{ window: { startAt: string; endAt: string }; usdPerMWh: number }>;
};

const node = 'ELAP_PACE-APND';
const sourceUrl = `https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_INTVL_LMP&version=3&market_run_id=RTM&node=${node}&resultformat=6`;
const maxZipBytes = 2 * 1024 * 1024;
const maxCsvBytes = 8 * 1024 * 1024;
const fiveMinutes = 300_000;
const hour = 3_600_000;

/** Reports provisional wholesale market prices, never retail bills or measured energy. */
export function parseCaisoCsv(csv: string, retrievedAt: string): CaisoSnapshot {
  if (!Number.isFinite(Date.parse(retrievedAt)) || new Date(retrievedAt).toISOString() !== retrievedAt) {
    throw new FeedError('Invalid CAISO retrieval timestamp');
  }
  const [columns, ...rows] = csvRows(csv);
  const required = ['INTERVALSTARTTIME_GMT', 'INTERVALENDTIME_GMT', 'NODE_ID', 'MARKET_RUN_ID', 'LMP_TYPE', 'VALUE'];
  if (!columns || required.some(name => columns.filter(column => column === name).length !== 1)) {
    throw new FeedError('Invalid CAISO CSV columns');
  }
  const indexes = required.map(name => columns.indexOf(name));
  const prices: CaisoSnapshot['prices'] = [];
  const periods = new Set<string>();
  for (const row of rows) {
    if (row.length !== columns.length) throw new FeedError('Invalid CAISO price row');
    const [rawStart, rawEnd, rowNode, market, type, rawPrice] = indexes.map(index => row[index]);
    if (rowNode !== node || market !== 'RTM' || type !== 'LMP') continue;
    const start = utcIntervalTime(rawStart);
    const end = utcIntervalTime(rawEnd);
    const price = Number(rawPrice);
    if (end - start !== fiveMinutes || start % fiveMinutes !== 0 ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawPrice) || !Number.isFinite(price)) {
      throw new FeedError('Invalid CAISO price row');
    }
    const startAt = new Date(start).toISOString();
    if (periods.has(startAt)) throw new FeedError('Duplicate CAISO price interval');
    periods.add(startAt);
    prices.push({ window: { startAt, endAt: new Date(end).toISOString() }, usdPerMWh: price });
  }
  if (!prices.length) throw new FeedError('CAISO returned no PACE real-time prices');
  prices.sort((a, b) => a.window.startAt.localeCompare(b.window.startAt));
  return {
    source: `CAISO OASIS RTM five-minute LMP for ${node}; provisional wholesale market price; retrieved ${retrievedAt}`,
    sourceUrl, retrievedAt, node, prices,
  };
}

export async function collectCaisoPrices(fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<CaisoSnapshot> {
  return (await collectCaisoPublication(fetcher, now)).snapshot;
}

export async function collectCaisoPublication(fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<{ snapshot: CaisoSnapshot; evidence: SourceEvidence }> {
  const end = Math.floor(now() / hour) * hour + hour;
  const url = new URL(sourceUrl);
  url.searchParams.set('startdatetime', oasisTime(end - 2 * hour));
  url.searchParams.set('enddatetime', oasisTime(end));
  let bytes: Uint8Array;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
    if (response.status === 429) {
      throw new FeedError('CAISO request was throttled; retrying later.', retryDelay(response.headers.get('Retry-After'), now()));
    }
    if (!response.ok) throw new FeedError(`CAISO request failed (HTTP ${response.status}).`);
    if (Number(response.headers.get('Content-Length')) > maxZipBytes) throw new FeedError('CAISO ZIP exceeds the size limit');
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxZipBytes) throw new FeedError('CAISO ZIP exceeds the size limit');
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError('CAISO request failed or timed out.');
  }
  const csv = priceCsv(bytes);
  const snapshot = parseCaisoCsv(csv, new Date(now()).toISOString());
  return { snapshot, evidence: { format: 'caiso-csv-v1', body: {
    sourceUrl, retrievedAt: snapshot.retrievedAt,
    query: { startdatetime: oasisTime(end - 2 * hour), enddatetime: oasisTime(end) }, csv,
  } } };
}

function priceCsv(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  let expandedBytes = 0;
  try {
    files = unzipSync(bytes, { filter(file) {
      if (!file.name.toLowerCase().endsWith('.csv')) return false;
      expandedBytes += file.originalSize;
      if (expandedBytes > maxCsvBytes) throw new FeedError('CAISO CSV exceeds the size limit');
      return true;
    } });
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError('CAISO returned an invalid ZIP');
  }
  const reports = Object.values(files);
  if (!reports.length) throw new FeedError('CAISO returned no price CSV');
  if (reports.length !== 1) throw new FeedError('CAISO returned multiple price CSV reports');
  if (reports[0].byteLength > maxCsvBytes) throw new FeedError('CAISO CSV exceeds the size limit');
  return strFromU8(reports[0]);
}

function utcIntervalTime(value: string): number {
  const matched = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:Z|[+-]00:00)$/.exec(value);
  const timestamp = Date.parse(value);
  if (!matched || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== matched[1]) {
    throw new FeedError('Invalid CAISO price row');
  }
  return timestamp;
}

function oasisTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replaceAll('-', '') + '-0000';
}

function retryDelay(value: string | null, now: number): number {
  if (!value) return fiveMinutes;
  const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? delay : fiveMinutes;
}

/** Small RFC 4180 reader; CAISO fields may be quoted, with commas and escaped quotes. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  const csv = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
    } else if (character === ',' || character === '\r' || character === '\n') {
      row.push(field);
      field = '';
      closedQuote = false;
      if (character !== ',') {
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        if (character === '\r' && csv[index + 1] === '\n') index++;
      }
    } else if (character === '"' && field === '' && !closedQuote) quoted = true;
    else {
      if (closedQuote || character === '"') throw new FeedError('Invalid CAISO CSV quoting');
      field += character;
    }
  }
  if (quoted) throw new FeedError('Invalid CAISO CSV quoting');
  row.push(field);
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}
