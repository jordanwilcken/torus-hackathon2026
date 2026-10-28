import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotRegionalGrid } from '../../../../src/core/energy/data/SnapshotRegionalGrid.js';
import { expectedBasis, fixture } from './fixture.js';

afterEach(() => vi.unstubAllGlobals());
describe('SnapshotRegionalGrid', () => {
  it.each(['missing hour', 'outside coverage', 'unknown region'])('preserves each metric accounting basis for %s', reason => {
    const input = fixture();
    input.rows.pop();
    const window = reason === 'outside coverage'
      ? { startAt: '2025-07-31T07:00:00Z', endAt: '2025-07-31T08:00:00Z' }
      : { startAt: '2025-07-31T06:00:00Z', endAt: '2025-07-31T07:00:00Z' };
    const actual = new SnapshotRegionalGrid([input]).read(reason === 'unknown region' ? 'UNKNOWN' : 'PACE', window).observations;
    const source = reason === 'missing hour' ? 'unavailable: missing hour in snapshot'
      : reason === 'outside coverage' ? 'unavailable: outside snapshot coverage' : 'unavailable: unknown region UNKNOWN';
    expect(actual.map(o => o.metric)).toEqual(Object.keys(expectedBasis));
    expect(actual.map(o => o.value)).toEqual([null, null, null, null]);
    expect(actual.map(o => o.source)).toEqual([source, source, source, source]);
    expect(actual.map(o => o.basis)).toEqual(Object.values(expectedBasis));
    expect(actual.map(o => o.unit)).toEqual(['gCO2/kWh', 'MW', 'MW', 'MW']);
  });
  it('returns only full UTC hours, four fixed-order metrics, and no forecasts or prices', () => {
    const grid = new SnapshotRegionalGrid([fixture()]);
    const result = grid.read('PACE', { startAt: '2025-07-31T05:30:00Z', endAt: '2025-07-31T07:30:00Z' });
    expect(result.observations).toHaveLength(4);
    expect(result.observations.map(o => o.metric)).toEqual(['consumption-carbon-intensity', 'demand', 'generation', 'interchange']);
    expect(result.observations.map(o => o.value)).toEqual([453.59237, 6000, 6100, 100]);
    expect(result.observations.map(o => o.basis)).toEqual(Object.values(expectedBasis));
    expect(result.observations.map(o => o.unit)).toEqual(['gCO2/kWh', 'MW', 'MW', 'MW']);
    expect(result.observations.every(o => o.window.startAt === '2025-07-31T06:00:00.000Z' && o.window.endAt === '2025-07-31T07:00:00.000Z')).toBe(true);
    expect(result.forecast).toEqual({});
    expect(grid.read('PACE', { startAt: '2025-07-31T05:01:00Z', endAt: '2025-07-31T05:59:00Z' }).observations).toEqual([]);
  });
  it('returns explicit unavailable hours outside coverage and for unknown regions', () => {
    const grid = new SnapshotRegionalGrid([fixture()]);
    const window = { startAt: '2025-07-31T04:00:00Z', endAt: '2025-07-31T08:00:00Z' };
    const known = grid.read('PACE', window).observations;
    expect(known).toHaveLength(16);
    expect(known.slice(4, 12).map(o => o.value)).toEqual([453.59237, 6000, 6100, 100, 453.59237, 6000, 6100, 100]);
    for (const o of [...known.slice(0, 4), ...known.slice(12), ...grid.read('UNKNOWN', window).observations]) {
      expect(o.value).toBeNull(); expect(o.source).toMatch(/^unavailable:/); expect(o.simulated).toBe(false);
    }
    expect(grid.read('UNKNOWN', window).observations).toHaveLength(16);
  });
  it('keeps missing hours inside coverage unavailable', () => {
    const input = fixture(); input.rows.pop();
    const result = new SnapshotRegionalGrid([input]).read('PACE', input.coverage).observations;
    expect(result).toHaveLength(8);
    for (const o of result.slice(4)) { expect(o.value).toBeNull(); expect(o.source).toMatch(/^unavailable:.*missing/i); }
  });
  it.each([
    { startAt: 'yesterday', endAt: '2025-07-31T07:00:00Z' },
    { startAt: '2025-07-31', endAt: '2025-08-01' },
    { startAt: '2025-02-30T00:00:00Z', endAt: '2025-03-02T00:00:00Z' },
    { startAt: '2025-07-31T06:00:00Z', endAt: '2025-07-31T06:00:00Z' },
    { startAt: '2025-07-31T07:00:00Z', endAt: '2025-07-31T06:00:00Z' },
  ])('rejects invalid query window $startAt / $endAt', window => {
    expect(() => new SnapshotRegionalGrid([fixture()]).read('PACE', window)).toThrow(RangeError);
  });
  it('replays deterministically with no fetch and isolates returned values from mutation', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network forbidden'); });
    const input = fixture(); const grid = new SnapshotRegionalGrid([input]);
    const first = grid.read('PACE', input.coverage);
    expect(first.observations).toHaveLength(8);
    expect(grid.read('PACE', input.coverage)).toEqual(first);
    first.observations[0].value = 0;
    first.observations[0].window.startAt = 'bad';
    input.rows[0].demandMW = 0;
    expect(grid.read('PACE', input.coverage).observations[0]).toMatchObject({ value: 453.59237, window: { startAt: '2025-07-31T05:00:00.000Z' } });
    expect(grid.read('PACE', input.coverage).observations[1].value).toBe(6000);
  });
});
