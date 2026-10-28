import { describe, expect, it } from 'vitest';
import { parseEiaApiResponse } from '../../../../src/core/energy/data/eiaApi.js';
import { ApiRegionalGrid } from '../../../../src/core/energy/data/ApiRegionalGrid.js';

const retrievedAt = '2026-10-28T07:15:00.000Z';
const source = `EIA-930 PACE API; retrieved ${retrievedAt}`;
const hour = { startAt: '2026-10-28T05:00:00.000Z', endAt: '2026-10-28T06:00:00.000Z' };
const forecastHour = { startAt: '2026-10-29T05:00:00.000Z', endAt: '2026-10-29T06:00:00.000Z' };

function row(type: string, value: unknown, period = '2026-10-28T06') {
  return { period, respondent: 'PACE', 'respondent-name': 'PacifiCorp East', type, value, 'value-units': 'megawatthours' };
}

function response(data = [row('D', '5000'), row('NG', '4500'), row('TI', '-500'), row('DF', '5100', '2026-10-29T06')]) {
  return { response: { frequency: 'hourly', dateFormat: 'YYYY-MM-DD"T"HH24', total: String(data.length), data } };
}

describe('EIA API normalization', () => {
  it('reports hourly demand, generation and signed interchange with their accounting basis', () => {
    const snapshot = parseEiaApiResponse(response(), retrievedAt);

    expect(snapshot).toMatchObject({ source, sourceUrl: 'https://api.eia.gov/v2/electricity/rto/region-data/data/', retrievedAt, regionId: 'PACE' });
    expect(snapshot.observations).toEqual([
      { regionId: 'PACE', metric: 'demand', value: 5000, unit: 'MW', window: hour, observedAt: hour.endAt, simulated: false, source, basis: 'EIA-930 reported hourly balancing-authority demand; hourly MWh expressed as average MW' },
      { regionId: 'PACE', metric: 'generation', value: 4500, unit: 'MW', window: hour, observedAt: hour.endAt, simulated: false, source, basis: 'EIA-930 reported hourly balancing-authority net generation; hourly MWh expressed as average MW; not a carbon intensity' },
      { regionId: 'PACE', metric: 'interchange', value: -500, unit: 'MW', window: hour, observedAt: hour.endAt, simulated: false, source, basis: 'EIA-930 reported hourly balancing-authority total interchange; hourly MWh expressed as average MW; positive is net export' },
    ]);
  });

  it('keeps future day-ahead demand separate from actual observations and carbon', () => {
    const snapshot = parseEiaApiResponse(response(), retrievedAt);

    expect(snapshot.forecast).toEqual({ demand: {
      source, scope: 'PACE', basis: 'EIA-930 reported day-ahead balancing-authority demand forecast; hourly MWh expressed as average MW; not a carbon forecast',
      unit: 'MW', retrievedAt, simulated: false, points: [{ window: forecastHour, value: 5100 }],
    } });
    expect(snapshot.forecast.demand).not.toHaveProperty('issuedAt');
    expect(snapshot.observations.some(observation => observation.window.endAt === forecastHour.endAt)).toBe(false);
    expect(snapshot.forecast.carbon).toBeUndefined();
  });

  it.each(['D', 'NG', 'TI'])('rejects future %s as an actual observation while accepting forecast horizons', type => {
    expect(() => parseEiaApiResponse(response([row(type, '5100', '2026-10-29T06')]), retrievedAt)).toThrow(/^EIA API observation is in the future$/);
  });

  it('retains unknown observed values and omits unknown forecast points instead of manufacturing zero', () => {
    const snapshot = parseEiaApiResponse(response([row('D', null), row('NG', '0'), row('DF', null)]), retrievedAt);

    expect(snapshot.observations.map(observation => [observation.metric, observation.value])).toEqual([['demand', null], ['generation', 0]]);
    expect(snapshot.observations[0].source).toBe(`unavailable: blank reported demand; ${source}`);
    expect(snapshot.forecast.demand?.points).toEqual([]);
  });

  it('sorts UTC intervals and metrics regardless of API row order', () => {
    const snapshot = parseEiaApiResponse(response([row('TI', '1', '2026-10-28T07'), row('NG', '4500'), row('D', '5000'), row('D', '5500', '2026-10-28T07')]), retrievedAt);
    expect(snapshot.observations.map(observation => [observation.observedAt, observation.metric])).toEqual([
      ['2026-10-28T06:00:00.000Z', 'demand'], ['2026-10-28T06:00:00.000Z', 'generation'],
      ['2026-10-28T07:00:00.000Z', 'demand'], ['2026-10-28T07:00:00.000Z', 'interchange'],
    ]);
  });

  it('never copies echoed request metadata or an API key into normalized provenance', () => {
    const payload = { ...response(), request: { api_key: 'secret-fixture-key', url: 'https://api.eia.gov/?api_key=secret-fixture-key' } };
    const actual = JSON.stringify(parseEiaApiResponse(payload, retrievedAt));
    expect(actual).not.toContain('secret-fixture-key');
    expect(actual).not.toContain('api_key');
  });

  it.each([
    ['wrong region', { respondent: 'CISO' }],
    ['wrong unit', { 'value-units': 'megawatts' }],
    ['unknown type', { type: 'CO2' }],
    ['date without hour', { period: '2026-10-28' }],
    ['invalid calendar date', { period: '2026-02-30T06' }],
    ['hour outside UTC format', { period: '2026-10-28T24' }],
    ['local timestamp', { period: '2026-10-28T06:00:00-06:00' }],
    ['blank numeric string', { value: '' }],
    ['partial numeric string', { value: '5000 MW' }],
    ['nonfinite number', { value: Infinity }],
    ['missing value', { value: undefined }],
  ])('rejects %s without exposing the row', (_name, change) => {
    const payload = response([{ ...row('D', '5000'), ...change, 'respondent-name': 'secret-fixture-key' }]);
    expect(() => parseEiaApiResponse(payload, retrievedAt)).toThrow(/^Invalid EIA API row$/);
  });

  it('rejects duplicate metric periods instead of choosing one report arbitrarily', () => {
    expect(() => parseEiaApiResponse(response([row('D', '5000'), row('D', '5100')]), retrievedAt)).toThrow('Duplicate EIA API metric period');
  });

  it('rejects partial pagination even when returned rows are otherwise valid', () => {
    const payload = response([row('D', '5000')]);
    payload.response.total = '5001';
    expect(() => parseEiaApiResponse(payload, retrievedAt)).toThrow('Incomplete EIA API response');
  });

  it.each([
    ['local-hourly frequency', { frequency: 'local-hourly' }],
    ['nonhourly date format', { dateFormat: 'YYYY-MM-DD' }],
    ['missing count', { total: undefined }],
    ['fractional count', { total: '1.5' }],
    ['missing data', { data: undefined }],
    ['empty data', { total: '0', data: [] }],
  ])('rejects %s metadata', (_name, change) => {
    const payload = response([row('D', '5000')]);
    expect(() => parseEiaApiResponse({ response: { ...payload.response, ...change } }, retrievedAt)).toThrow();
  });

  it.each(['error', 'errors', 'warning', 'warnings'])('rejects API %s without echoing upstream text', field => {
    const payload = { ...response(), [field]: 'secret-fixture-key' };
    expect(() => parseEiaApiResponse(payload, retrievedAt)).toThrow(/^EIA API reported an error or warning$/);
    const nested = response();
    expect(() => parseEiaApiResponse({ response: { ...nested.response, [field]: 'secret-fixture-key' } }, retrievedAt)).toThrow(/^EIA API reported an error or warning$/);
  });

  it('requires an explicit valid retrieval timestamp distinct from the reported interval', () => {
    expect(() => parseEiaApiResponse(response(), '2026-10-28')).toThrow('Invalid EIA API retrieval timestamp');
  });
});

describe('ApiRegionalGrid', () => {
  it('returns complete intervals within the requested region and window', () => {
    const grid = new ApiRegionalGrid(parseEiaApiResponse(response(), retrievedAt));
    const actual = grid.read('PACE', { startAt: '2026-10-28T05:30:00Z', endAt: '2026-10-29T06:30:00Z' });
    expect(actual.observations).toEqual([]);
    expect(actual.forecast.demand?.points).toEqual([{ window: forecastHour, value: 5100 }]);
    expect(grid.read('PACE', hour).observations.map(observation => observation.value)).toEqual([5000, 4500, -500]);
    expect(grid.read('CISO', hour)).toEqual({ observations: [], forecast: {} });
  });

  it('keeps missing hours and carbon unknown, and does not leak points outside the query', () => {
    const grid = new ApiRegionalGrid(parseEiaApiResponse(response(), retrievedAt));
    expect(grid.read('PACE', { startAt: '2026-10-28T08:00:00Z', endAt: '2026-10-28T09:00:00Z' })).toEqual({ observations: [], forecast: {} });
    expect(grid.read('PACE', hour).forecast).toEqual({});
  });

  it('isolates snapshot and returned values from consumer mutation', () => {
    const snapshot = parseEiaApiResponse(response(), retrievedAt);
    const grid = new ApiRegionalGrid(snapshot);
    const window = { startAt: hour.startAt, endAt: forecastHour.endAt };
    const first = grid.read('PACE', window);
    first.observations[0].value = 0;
    first.observations[0].window.startAt = 'changed';
    first.forecast.demand!.points[0].value = 0;
    first.forecast.demand!.points[0].window.startAt = 'changed';
    snapshot.observations[0].value = 1;
    snapshot.forecast.demand!.points[0].value = 1;

    const next = grid.read('PACE', window);
    expect(next.observations[0]).toMatchObject({ value: 5000, window: hour });
    expect(next.forecast.demand?.points).toEqual([{ value: 5100, window: forecastHour }]);
  });

  it('rejects a reversed or unzoned query window', () => {
    const grid = new ApiRegionalGrid(parseEiaApiResponse(response(), retrievedAt));
    expect(() => grid.read('PACE', { startAt: hour.endAt, endAt: hour.startAt })).toThrow(RangeError);
    expect(() => grid.read('PACE', { startAt: '2026-10-28T05:00:00', endAt: hour.endAt })).toThrow(RangeError);
  });
});
