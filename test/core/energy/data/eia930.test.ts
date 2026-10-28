import { describe, expect, it } from 'vitest';
import { excelSerialToUtcIso, lbsPerKWhToGramsPerKWh, observationsFromSnapshot, parseEia930Snapshot, rowsFromSheet } from '../../../../src/core/energy/data/eia930.js';
import { expectedBasis, fixture, row } from './fixture.js';

describe('EIA-930 pure normalization', () => {
  it('declares the exact accounting basis and unit for every reported metric', () => {
    const actual = observationsFromSnapshot(fixture()).slice(0, 4);
    expect(actual).toHaveLength(4);
    for (const [index, metric] of (['consumption-carbon-intensity', 'demand', 'generation', 'interchange'] as const).entries()) {
      expect(actual[index].metric).toBe(metric);
      expect(actual[index].basis).toBe(expectedBasis[metric]);
      expect(actual[index].unit).toBe(metric === 'consumption-carbon-intensity' ? 'gCO2/kWh' : 'MW');
    }
  });
  it('keeps the same accounting basis for blank intensity and MW values', () => {
    const input = fixture();
    Object.assign(input.rows[0], { consumedIntensityLbsPerKWh: null, demandMW: null, netGenerationMW: null, totalInterchangeMW: null });
    const actual = observationsFromSnapshot(input).slice(0, 4);
    expect(actual.map(o => o.value)).toEqual([null, null, null, null]);
    expect(actual.map(o => o.source)).toEqual([
      'unavailable: blank consumed intensity; EIA-930 PACE workbook; retrieved 2026-10-27T22:16:00.000Z',
      'unavailable: blank reported demand; EIA-930 PACE workbook; retrieved 2026-10-27T22:16:00.000Z',
      'unavailable: blank reported generation; EIA-930 PACE workbook; retrieved 2026-10-27T22:16:00.000Z',
      'unavailable: blank reported interchange; EIA-930 PACE workbook; retrieved 2026-10-27T22:16:00.000Z',
    ]);
    expect(actual.map(o => o.basis)).toEqual(Object.values(expectedBasis));
  });
  it('rounds Excel floating point error to seconds without changing the UTC hour', () => {
    expect(excelSerialToUtcIso(42186.291666666664)).toBe('2015-07-01T07:00:00.000Z');
    expect(excelSerialToUtcIso(45869.25)).toBe('2025-07-31T06:00:00.000Z');
    expect(() => excelSerialToUtcIso(NaN)).toThrow(/finite/i);
  });
  it('converts pounds per kWh using independent unit expectations', () => {
    expect(lbsPerKWhToGramsPerKWh(1)).toBe(453.59237);
    expect(lbsPerKWhToGramsPerKWh(1.263512)).toBeCloseTo(573.1194, 3);
  });
  it('preserves provenance and maps hour endings, metrics, sign and blanks', () => {
    const input = fixture();
    input.rows[0].netGenerationMW = null;
    input.rows[0].totalInterchangeMW = -100;
    expect(parseEia930Snapshot(input).provenance).toEqual(input.provenance);
    const observations = observationsFromSnapshot(input);
    expect(observations).toHaveLength(8);
    expect(observations.slice(0, 4).map(o => [o.metric, o.value, o.unit])).toEqual([
      ['consumption-carbon-intensity', 453.59237, 'gCO2/kWh'], ['demand', 6000, 'MW'], ['generation', null, 'MW'], ['interchange', -100, 'MW'],
    ]);
    expect(observations[0]).toMatchObject({ window: { startAt: '2025-07-31T05:00:00.000Z', endAt: '2025-07-31T06:00:00.000Z' }, observedAt: '2025-07-31T06:00:00.000Z', simulated: false });
    for (const o of observations) expect(o.source).toMatch(/EIA-930 PACE.*2026-10-27/);
  });
  it('withholds EIA imputed MW and labels intensity inputs', () => {
    const input = fixture();
    input.rows[0].imputed = { demand: true, netGeneration: true, totalInterchange: true, generationBySource: false };
    const actual = observationsFromSnapshot(input).slice(0, 4);
    expect(actual).toHaveLength(4);
    expect(actual[0].source).toContain('includes EIA-imputed inputs');
    expect(actual[0].value).toBe(453.59237);
    for (const o of actual.slice(1)) {
      expect(o.value).toBeNull();
      expect(o.source).toContain('imputed by EIA; reported value unavailable');
    }
    input.rows[0].consumedIntensityLbsPerKWh = null;
    const blank = observationsFromSnapshot(input)[0];
    expect(blank.value).toBeNull();
    expect(blank.source).toBe('unavailable: blank consumed intensity; EIA-930 PACE workbook; retrieved 2026-10-27T22:16:00.000Z');
  });
  it.each(['demand', 'netGeneration', 'totalInterchange', 'generationBySource'] as const)('labels intensity when only %s is imputed and withholds only its MW metric', flag => {
    const input = fixture();
    input.rows[0].imputed[flag] = true;
    const actual = observationsFromSnapshot(parseEia930Snapshot(input)).slice(0, 4);
    expect(actual.map(o => o.basis)).toEqual(Object.values(expectedBasis));
    expect(actual[0].source).toContain('; intensity includes EIA-imputed inputs');
    expect(actual[0].value).toBe(453.59237);
    expect(actual.slice(1).map(o => o.value)).toEqual([flag === 'demand' ? null : 6000, flag === 'netGeneration' ? null : 6100, flag === 'totalInterchange' ? null : 100]);
    expect(actual.slice(1).map(o => o.source.includes('imputed by EIA; reported value unavailable'))).toEqual([flag === 'demand', flag === 'netGeneration', flag === 'totalInterchange']);
  });
  it.each([
    ['empty rows', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [] }), /rows.*nonempty/i],
    ['negative intensity', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [{ ...s.rows[0], consumedIntensityLbsPerKWh: -1 }] }), /consumedIntensityLbsPerKWh.*nonnegative/i],
    ['schemaVersion', (s: ReturnType<typeof fixture>) => ({ ...s, schemaVersion: 2 }), /schemaVersion/],
    ['duplicate', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [s.rows[0], s.rows[0]] }), /duplicate/i],
    ['alignment', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [row('2025-07-31T06:01:00Z')] }), /hour.aligned/i],
    ['nonfinite', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [{ ...s.rows[0], demandMW: Infinity }] }), /demandMW.*finite/i],
    ['wrong unit', (s: ReturnType<typeof fixture>) => ({ ...s, provenance: { ...s.provenance, units: { ...s.provenance.units, consumedIntensityLbsPerKWh: 'lbs/MWh' } } }), /unit/i],
    ['coverage', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [row('2025-08-01T06:00:00Z')] }), /coverage/i],
  ])('rejects malformed snapshot: %s', (_name, mutate, pattern) => {
    expect(() => parseEia930Snapshot(mutate(fixture()))).toThrow(pattern);
  });
  it.each([undefined, [], [''], [42], 'Imputed OTH Gen', ['Bogus'], ['Imputed demand'], ['Imputed OTH Gen', 'Imputed OTH Gen']])('rejects invalid imputed-generation provenance %j', imputedGenerationColumns => {
    const input = fixture();
    expect(() => parseEia930Snapshot({ ...input, provenance: { ...input.provenance, imputedGenerationColumns } })).toThrow(/imputedGenerationColumns/);
  });
  it('requires the generationBySource flag', () => {
    const input = fixture();
    expect(() => parseEia930Snapshot({ ...input, rows: [{ ...input.rows[0], imputed: { demand: false, netGeneration: false, totalInterchange: false } }] })).toThrow(/generationBySource.*boolean/);
  });
  it.each([
    ['NaN', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [{ ...s.rows[0], demandMW: NaN }] }), /demandMW.*finite/],
    ['duplicate', (s: ReturnType<typeof fixture>) => ({ ...s, rows: [s.rows[0], s.rows[0]] }), /duplicate/],
  ])('validates unparsed %s evidence before emitting observations', (_name, mutate, pattern) => {
    expect(() => observationsFromSnapshot(mutate(fixture()))).toThrow(pattern);
  });
  it('keeps anomalous reported demand and net generation signed along with interchange', () => {
    const input = fixture();
    Object.assign(input.rows[0], { demandMW: -5, netGenerationMW: -10, totalInterchangeMW: -15, consumedIntensityLbsPerKWh: 0 });
    expect(parseEia930Snapshot(input).rows[0]).toMatchObject({ demandMW: -5, netGenerationMW: -10, totalInterchangeMW: -15, consumedIntensityLbsPerKWh: 0 });
    expect(observationsFromSnapshot(input).slice(0, 4).map(o => o.value)).toEqual([0, -5, -10, -15]);
  });
  it('orders repeated local fall-back hours by their distinct UTC keys', () => {
    const input = fixture();
    input.coverage = { startAt: '2025-11-02T06:00:00Z', endAt: '2025-11-02T08:00:00Z' };
    input.rows = [row('2025-11-02T08:00:00Z'), row('2025-11-02T07:00:00Z')].map(r => ({ ...r, localDate: '2025-11-02', localHour: 1 }));
    expect(observationsFromSnapshot(parseEia930Snapshot(input)).filter(o => o.metric === 'demand').map(o => o.observedAt)).toEqual(['2025-11-02T07:00:00.000Z', '2025-11-02T08:00:00.000Z']);
  });
});

describe('rowsFromSheet (hand-written workbook fixture)', () => {
  const headers = ['Demand', 'UTC time', 'Hour', 'BA', 'Local date', 'Time zone', 'Net generation', 'Total interchange', 'CO2 Emissions Intensity for Consumed Electricity', 'Imputed demand', 'Imputed net generation', 'Imputed total interchange', 'Imputed OTH Gen'];
  const cells = [null, 45869.25, 1, 'PACE', 45869, 'MDT', undefined, '', 1, 0, null, ''];
  const window = { startAt: '2025-07-31T05:00:00Z', endAt: '2025-07-31T07:00:00Z' };
  it('looks up headers by text, retains blanks and treats a published imputed zero as imputed', () => {
    expect(rowsFromSheet([headers, cells], window)).toEqual([{ ...row(), demandMW: null, netGenerationMW: null, totalInterchangeMW: null, imputed: { demand: true, netGeneration: false, totalInterchange: false, generationBySource: false } }]);
  });
  it.each([85, 0])('tracks per-fuel imputation including %s without withholding reported MW', value => {
    const window = { startAt: '2018-08-08T00:00:00Z', endAt: '2018-08-08T01:00:00Z' };
    const actual = rowsFromSheet([headers, [7546, 43320.041666666664, 19, 'PACE', 43319, 'MDT', 7671, 125, 1.4436062642144429, null, '', undefined, value]], window);
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({ utcHourEnding: '2018-08-08T01:00:00.000Z', demandMW: 7546, netGenerationMW: 7671, totalInterchangeMW: 125, consumedIntensityLbsPerKWh: 1.4436062642144429, imputed: { demand: false, netGeneration: false, totalInterchange: false, generationBySource: true } });
    const input = { ...fixture(), coverage: window, rows: actual };
    const observations = observationsFromSnapshot(parseEia930Snapshot(input));
    expect(observations[0].source).toContain('; intensity includes EIA-imputed inputs');
    expect(observations.slice(1).map(o => o.value)).toEqual([7546, 7671, 125]);
  });
  it.each(['Imputed COL Gen', 'Imputed NG Gen', 'Imputed NUC Gen', 'Imputed OIL Gen', 'Imputed GEO Gen', 'Imputed WAT Gen', 'Imputed PS Gen', 'Imputed SUN Gen', 'Imputed SNB Gen', 'Imputed WND Gen', 'Imputed WNB Gen', 'Imputed BAT Gen', 'Imputed OES Gen', 'Imputed UES Gen', 'Imputed OTH Gen', 'Imputed UNK Gen'])('discovers %s by its header pattern', header => {
    expect(rowsFromSheet([[...headers.slice(0, -1), header], [...cells, 0]], window)[0].imputed).toMatchObject({ generationBySource: true });
  });
  it('rejects sheets with no per-fuel imputation columns', () => {
    expect(() => rowsFromSheet([headers.slice(0, -1), cells], window)).toThrow(/Imputed .+ Gen/);
  });
  it('filters whole hours, sorts and rejects duplicate UTC hours', () => {
    expect(rowsFromSheet([headers, [...cells.slice(0, 1), 45869.291666666664, ...cells.slice(2)], cells], window).map(r => r.utcHourEnding)).toEqual(['2025-07-31T06:00:00.000Z', '2025-07-31T07:00:00.000Z']);
    expect(rowsFromSheet([headers, cells], { startAt: '2025-07-31T05:30:00Z', endAt: '2025-07-31T07:00:00Z' })).toEqual([]);
    expect(() => rowsFromSheet([headers, cells, cells], window)).toThrow(/duplicate/i);
  });
  it('rejects a missing header and a nonnumeric UTC serial', () => {
    expect(() => rowsFromSheet([headers.slice(1), cells.slice(1)], window)).toThrow(/Demand/);
    expect(() => rowsFromSheet([headers, [null, '2025-07-31T06:00:00Z', ...cells.slice(2)]], window)).toThrow(/UTC time.*number/);
  });
});
