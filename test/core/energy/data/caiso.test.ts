import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { collectCaisoPrices, parseCaisoCsv } from '../../../../src/server/caiso.js';
import { FeedError } from '../../../../src/server/cachedFeed.js';

const retrievedAt = '2026-10-28T08:16:00.000Z';
const interval = { startAt: '2026-10-28T08:00:00.000Z', endAt: '2026-10-28T08:05:00.000Z' };
const laterInterval = { startAt: '2026-10-28T08:05:00.000Z', endAt: '2026-10-28T08:10:00.000Z' };
const header = 'INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,NODE_ID,MARKET_RUN_ID,LMP_TYPE,VALUE';

function priceRow(value: string, change: Record<string, string> = {}) {
  const record = { INTERVALSTARTTIME_GMT: '2026-10-28T08:00:00-00:00', INTERVALENDTIME_GMT: '2026-10-28T08:05:00-00:00', NODE_ID: 'ELAP_PACE-APND', MARKET_RUN_ID: 'RTM', LMP_TYPE: 'LMP', VALUE: value, ...change };
  return header.split(',').map(column => record[column as keyof typeof record]).join(',');
}

function csv(...rows: string[]) { return [header, ...rows, ''].join('\r\n'); }
function archive(files: Record<string, string>) { return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))); }
function zipResponse(files: Record<string, string>) { return new Response(Buffer.from(archive(files)), { headers: { 'Content-Type': 'application/x-zip-compressed' } }); }

describe('CAISO PACE market prices', () => {
  it('selects total PACE real-time LMP, preserves negative prices, and sorts five-minute UTC intervals', () => {
    const snapshot = parseCaisoCsv(csv(
      priceRow('42.5', { INTERVALSTARTTIME_GMT: '2026-10-28T08:05:00-00:00', INTERVALENDTIME_GMT: '2026-10-28T08:10:00-00:00' }),
      priceRow('-7.125'),
      priceRow('100', { NODE_ID: 'ELAP_PACW-APND' }),
      priceRow('0.25', { LMP_TYPE: 'MCC' }),
      priceRow('9', { MARKET_RUN_ID: 'DAM' }),
    ), retrievedAt);

    expect(snapshot).toMatchObject({ node: 'ELAP_PACE-APND', retrievedAt, sourceUrl: 'https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_INTVL_LMP&version=3&market_run_id=RTM&node=ELAP_PACE-APND&resultformat=6' });
    expect(snapshot.source).toContain('CAISO OASIS');
    expect(snapshot.source).toContain('provisional');
    expect(snapshot.prices).toEqual([{ window: interval, usdPerMWh: -7.125 }, { window: laterInterval, usdPerMWh: 42.5 }]);
    expect(snapshot).not.toHaveProperty('demand');
    expect(snapshot).not.toHaveProperty('carbon');
  });

  it('accepts quoted CSV fields from the published ZIP format', () => {
    expect(parseCaisoCsv(csv(priceRow('"-7.125"', { NODE_ID: '"ELAP_PACE-APND"' })), retrievedAt).prices).toEqual([{ window: interval, usdPerMWh: -7.125 }]);
  });

  it.each([
    ['blank price', { VALUE: '' }],
    ['nonfinite price', { VALUE: 'Infinity' }],
    ['price with units', { VALUE: '42 USD' }],
    ['non-UTC time', { INTERVALSTARTTIME_GMT: '2026-10-28T08:00:00-07:00' }],
    ['invalid calendar date', { INTERVALSTARTTIME_GMT: '2026-02-30T08:00:00-00:00', INTERVALENDTIME_GMT: '2026-02-30T08:05:00-00:00' }],
    ['hourly interval', { INTERVALENDTIME_GMT: '2026-10-28T09:00:00-00:00' }],
    ['unaligned interval', { INTERVALSTARTTIME_GMT: '2026-10-28T08:01:00-00:00', INTERVALENDTIME_GMT: '2026-10-28T08:06:00-00:00' }],
  ])('rejects a %s instead of fabricating usable market data', (_description, change) => {
    expect(() => parseCaisoCsv(csv(priceRow('42.5', change)), retrievedAt)).toThrow('Invalid CAISO price row');
  });

  it('rejects duplicate intervals instead of choosing a price arbitrarily', () => {
    expect(() => parseCaisoCsv(csv(priceRow('42'), priceRow('43')), retrievedAt)).toThrow('Duplicate CAISO price interval');
  });

  it('rejects reports with no PACE total LMP or missing required columns', () => {
    expect(() => parseCaisoCsv(csv(priceRow('42', { LMP_TYPE: 'MCE' })), retrievedAt)).toThrow('CAISO returned no PACE real-time prices');
    expect(() => parseCaisoCsv('NODE_ID,VALUE\nELAP_PACE-APND,42', retrievedAt)).toThrow('Invalid CAISO CSV columns');
  });

  it('fetches the recent two-hour window as public ZIP CSV and records retrieval time', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(zipResponse({ 'PRC_INTVL_LMP.csv': csv(priceRow('-7.125')) }));
    const snapshot = await collectCaisoPrices(fetcher, () => Date.parse(retrievedAt));
    const request = new URL(String(fetcher.mock.calls[0][0]));

    expect(request.origin + request.pathname).toBe('https://oasis.caiso.com/oasisapi/SingleZip');
    expect(Object.fromEntries(request.searchParams)).toEqual({ queryname: 'PRC_INTVL_LMP', version: '3', market_run_id: 'RTM', node: 'ELAP_PACE-APND', resultformat: '6', startdatetime: '20261028T07:00-0000', enddatetime: '20261028T09:00-0000' });
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(snapshot.prices).toEqual([{ window: interval, usdPerMWh: -7.125 }]);
    expect(snapshot.retrievedAt).toBe(retrievedAt);
  });

  it('returns a retry delay on throttling without exposing the upstream body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream-private-debug', { status: 429, headers: { 'Retry-After': '120' } }));
    const result = collectCaisoPrices(fetcher, () => Date.parse(retrievedAt));
    await expect(result).rejects.toBeInstanceOf(FeedError);
    await expect(result).rejects.toMatchObject({ message: 'CAISO request was throttled; retrying later.', retryAfterMs: 120_000 });
  });

  it('honors an HTTP-date retry delay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': 'Wed, 28 Oct 2026 08:21:00 GMT' } }));
    await expect(collectCaisoPrices(fetcher, () => Date.parse(retrievedAt))).rejects.toMatchObject({ retryAfterMs: 300_000 });
  });

  it('treats XML error reports and malformed archives as unavailable with safe diagnostics', async () => {
    const xml = vi.fn<typeof fetch>().mockResolvedValue(zipResponse({ 'error.xml': '<ERR_DESC>upstream-private-debug</ERR_DESC>' }));
    await expect(collectCaisoPrices(xml)).rejects.toThrow('CAISO returned no price CSV');
    const broken = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream-private-debug'));
    await expect(collectCaisoPrices(broken)).rejects.toThrow('CAISO returned an invalid ZIP');
  });

  it('rejects multiple CSV reports rather than silently dropping part of the response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(zipResponse({ 'part1.csv': csv(priceRow('42')), 'part2.csv': csv(priceRow('43')) }));
    await expect(collectCaisoPrices(fetcher)).rejects.toThrow('CAISO returned multiple price CSV reports');
  });

  it('keeps upstream HTTP and transport errors out of published diagnostics', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream-private-debug', { status: 503 }));
    await expect(collectCaisoPrices(http)).rejects.toThrow('CAISO request failed (HTTP 503).');
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('upstream-private-debug'));
    await expect(collectCaisoPrices(network)).rejects.toThrow('CAISO request failed or timed out.');
  });
});
