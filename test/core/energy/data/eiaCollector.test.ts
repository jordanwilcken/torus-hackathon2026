import { expect, test } from 'vitest';
import { collectEiaSnapshot } from '../../../../src/server/eia';

const now = () => Date.parse('2026-10-28T08:00:00Z');
const payload = { response: { frequency: 'hourly', dateFormat: 'YYYY-MM-DD"T"HH24', total: '1', data: [
  { period: '2026-10-28T07', respondent: 'PACE', type: 'D', value: '5429', 'value-units': 'megawatthours' },
] }, request: { params: { api_key: 'secret-fixture' } } };

test('collects a bounded PACE window and publishes normalized evidence without credentials', async () => {
  let requested!: URL;
  const fetcher = (async input => {
    requested = new URL(String(input));
    return Response.json(payload);
  }) as typeof fetch;
  const snapshot = await collectEiaSnapshot('secret-fixture', fetcher, now);
  expect(requested.origin).toBe('https://api.eia.gov');
  expect(requested.searchParams.get('api_key')).toBe('secret-fixture');
  expect(requested.searchParams.get('facets[respondent][]')).toBe('PACE');
  expect(requested.searchParams.get('start')).toBe('2026-10-25T08');
  expect(requested.searchParams.get('end')).toBe('2026-10-29T08');
  expect(requested.searchParams.get('length')).toBe('5000');
  expect(snapshot.observations[0].value).toBe(5429);
  expect(snapshot.retrievedAt).toBe('2026-10-28T08:00:00.000Z');
  expect(JSON.stringify(snapshot)).not.toContain('secret-fixture');
});

test('does not call EIA without a configured key', async () => {
  let called = false;
  await expect(collectEiaSnapshot('', (async () => { called = true; return Response.json(payload); }) as typeof fetch, now))
    .rejects.toThrow('Set EIA_API_KEY in the server environment.');
  expect(called).toBe(false);
});

test('respects EIA rate-limit backoff without disclosing the upstream body', async () => {
  const fetcher = (async () => new Response('secret-fixture', { status: 429, headers: { 'Retry-After': '1200' } })) as typeof fetch;
  await expect(collectEiaSnapshot('secret-fixture', fetcher, now)).rejects.toMatchObject({
    message: 'EIA rate limited the request; retry is delayed.', retryAfterMs: 1_200_000,
  });
});

test('a network error never exposes the API key in its message', async () => {
  const fetcher = (async () => { throw new Error('https://api.eia.gov/?api_key=secret-fixture'); }) as typeof fetch;
  await expect(collectEiaSnapshot('secret-fixture', fetcher, now)).rejects.toThrow('EIA could not be reached.');
});
