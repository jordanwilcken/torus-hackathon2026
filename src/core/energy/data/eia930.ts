import type { TimeWindow } from '../../TimeWindow.type.js';
import type { GridObservation } from '../GridObservation.interface.js';

export const EIA930_BASIS = {
  'consumption-carbon-intensity': 'EIA-930 consumption-based average operational CO2 of electricity consumed in the balancing authority, including interchange (EIA multiregional model); not a generation-weighted lifecycle CO2e proxy or marginal emissions',
  demand: 'EIA-930 reported hourly balancing-authority demand; hourly MWh expressed as average MW',
  generation: 'EIA-930 reported hourly balancing-authority net generation; hourly MWh expressed as average MW; not a carbon intensity',
  interchange: 'EIA-930 reported hourly balancing-authority total interchange; hourly MWh expressed as average MW; positive is net export',
} as const;

export const EIA930_COLUMNS = {
  regionId: 'BA', utcHourEnding: 'UTC time', localDate: 'Local date', localHour: 'Hour', timeZone: 'Time zone',
  demandMW: 'Demand', netGenerationMW: 'Net generation', totalInterchangeMW: 'Total interchange',
  consumedIntensityLbsPerKWh: 'CO2 Emissions Intensity for Consumed Electricity',
  imputedDemand: 'Imputed demand', imputedNetGeneration: 'Imputed net generation', imputedTotalInterchange: 'Imputed total interchange',
} as const;
export const EIA930_UNITS = {
  demandMW: 'MWh', netGenerationMW: 'MWh', totalInterchangeMW: 'MWh', consumedIntensityLbsPerKWh: 'lbs/kWh',
} as const;
export type Eia930Row = {
  utcHourEnding: string;
  localDate: string;
  localHour: number;
  timeZone: string;
  demandMW: number | null;
  netGenerationMW: number | null;
  totalInterchangeMW: number | null;
  consumedIntensityLbsPerKWh: number | null;
  imputed: { demand: boolean; netGeneration: boolean; totalInterchange: boolean; generationBySource: boolean };
};
export type Eia930Snapshot = {
  schemaVersion: 1;
  regionId: 'PACE';
  provenance: {
    source: string; sourceUrl: string; retrievedAt: string; sha256: string; sheet: string;
    columns: Record<keyof typeof EIA930_COLUMNS, string>;
    units: Record<keyof typeof EIA930_UNITS, string>;
    imputedGenerationColumns: string[];
    notes: string[];
  };
  coverage: TimeWindow;
  rows: Eia930Row[];
};

const HOUR = 3_600_000;
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}
function nullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : finite(value, label);
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}
export function isoTime(value: unknown, label: string): number {
  const text = string(value, label);
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(text);
  const time = Date.parse(text);
  if (!match || !Number.isFinite(time) || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) {
    throw new Error(`${label} must be a valid ISO timestamp with timezone`);
  }
  return time;
}
export function windowBounds(window: TimeWindow): [number, number] {
  try {
    const start = isoTime(window.startAt, 'startAt');
    const end = isoTime(window.endAt, 'endAt');
    if (end <= start) throw new Error('endAt must be after startAt');
    return [start, end];
  } catch (error) {
    throw new RangeError(`Invalid window: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export function excelSerialToUtcIso(serial: number): string {
  finite(serial, 'Excel serial');
  const time = Date.UTC(1899, 11, 30) + Math.round(serial * 86400) * 1000;
  if (!Number.isFinite(time) || Math.abs(time) > 8.64e15) throw new Error('Excel serial outside supported date range');
  return new Date(time).toISOString();
}
export function lbsPerKWhToGramsPerKWh(value: number): number {
  return finite(value, 'Intensity') * 453.59237;
}
function validateRows(values: unknown[], coverage: TimeWindow): Eia930Row[] {
  const [start, end] = windowBounds(coverage);
  const seen = new Set<number>();
  return values.map((value, index) => {
    const label = `rows[${index}]`;
    const r = object(value, label);
    const hourEnd = isoTime(r.utcHourEnding, `${label}.utcHourEnding`);
    if (hourEnd % HOUR !== 0) throw new Error(`${label}.utcHourEnding must be hour-aligned`);
    if (seen.has(hourEnd)) throw new Error(`duplicate UTC hour at ${r.utcHourEnding}`);
    seen.add(hourEnd);
    if (hourEnd - HOUR < start || hourEnd > end) throw new Error(`${label} lies outside coverage`);
    const localDate = string(r.localDate, `${label}.localDate`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error(`${label}.localDate must be YYYY-MM-DD`);
    isoTime(`${localDate}T00:00:00Z`, `${label}.localDate`);
    const localHour = finite(r.localHour, `${label}.localHour`);
    if (!Number.isInteger(localHour) || localHour < 0 || localHour > 25) throw new Error(`${label}.localHour must be an hour label between 0 and 25`);
    const imputed = object(r.imputed, `${label}.imputed`);
    const intensity = nullableNumber(r.consumedIntensityLbsPerKWh, `${label}.consumedIntensityLbsPerKWh`);
    if (intensity !== null && intensity < 0) throw new Error(`${label}.consumedIntensityLbsPerKWh must be nonnegative`);
    return {
      utcHourEnding: new Date(hourEnd).toISOString(), localDate, localHour,
      timeZone: string(r.timeZone, `${label}.timeZone`),
      demandMW: nullableNumber(r.demandMW, `${label}.demandMW`),
      netGenerationMW: nullableNumber(r.netGenerationMW, `${label}.netGenerationMW`),
      totalInterchangeMW: nullableNumber(r.totalInterchangeMW, `${label}.totalInterchangeMW`),
      consumedIntensityLbsPerKWh: intensity,
      imputed: { demand: boolean(imputed.demand, `${label}.imputed.demand`), netGeneration: boolean(imputed.netGeneration, `${label}.imputed.netGeneration`), totalInterchange: boolean(imputed.totalInterchange, `${label}.imputed.totalInterchange`), generationBySource: boolean(imputed.generationBySource, `${label}.imputed.generationBySource`) },
    };
  }).sort((a, b) => a.utcHourEnding.localeCompare(b.utcHourEnding));
}
export function parseEia930Snapshot(json: unknown): Eia930Snapshot {
  const root = object(json, 'snapshot');
  if (root.schemaVersion !== 1) throw new Error('snapshot.schemaVersion must be 1');
  if (root.regionId !== 'PACE') throw new Error('snapshot.regionId must be PACE');
  const coverage = object(root.coverage, 'coverage');
  const period = { startAt: string(coverage.startAt, 'coverage.startAt'), endAt: string(coverage.endAt, 'coverage.endAt') };
  const [start, end] = windowBounds(period);
  if (start % HOUR || end % HOUR) throw new Error('coverage must be hour-aligned');
  const p = object(root.provenance, 'provenance');
  const columns = object(p.columns, 'provenance.columns');
  const units = object(p.units, 'provenance.units');
  for (const [key, header] of Object.entries(EIA930_COLUMNS)) {
    if (columns[key] !== header) throw new Error(`provenance.columns.${key} must be ${header}`);
  }
  for (const [key, unit] of Object.entries(EIA930_UNITS)) {
    if (units[key] !== unit) throw new Error(`provenance.units.${key} must be ${unit}`);
  }
  const source = string(p.source, 'provenance.source');
  const sourceUrl = string(p.sourceUrl, 'provenance.sourceUrl');
  if (!/^https:\/\//.test(sourceUrl)) throw new Error('provenance.sourceUrl must be HTTPS');
  const retrievedAt = string(p.retrievedAt, 'provenance.retrievedAt');
  isoTime(retrievedAt, 'provenance.retrievedAt');
  const sha256 = string(p.sha256, 'provenance.sha256');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('provenance.sha256 must be a SHA-256 hex digest');
  if (p.sheet !== 'Published Hourly Data') throw new Error('provenance.sheet must be Published Hourly Data');
  if (!Array.isArray(p.imputedGenerationColumns) || !p.imputedGenerationColumns.length) throw new Error('provenance.imputedGenerationColumns must be a nonempty string array');
  const imputedGenerationColumns = p.imputedGenerationColumns.map((header, i) => {
    const text = string(header, `provenance.imputedGenerationColumns[${i}]`);
    if (!/^Imputed .+ Gen$/.test(text)) throw new Error(`provenance.imputedGenerationColumns[${i}] must match /^Imputed .+ Gen$/`);
    return text;
  });
  if (new Set(imputedGenerationColumns).size !== imputedGenerationColumns.length) throw new Error('provenance.imputedGenerationColumns must not repeat a header');
  if (!Array.isArray(p.notes)) throw new Error('provenance.notes must be an array');
  if (!Array.isArray(root.rows) || !root.rows.length) throw new Error('snapshot.rows must be a nonempty array');
  return {
    schemaVersion: 1, regionId: 'PACE',
    provenance: { source, sourceUrl, retrievedAt, sha256, sheet: p.sheet, columns: { ...EIA930_COLUMNS }, units: { ...EIA930_UNITS }, imputedGenerationColumns, notes: p.notes.map((note, i) => string(note, `notes[${i}]`)) },
    coverage: { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() },
    rows: validateRows(root.rows, period),
  };
}
export function observationsFromSnapshot(input: unknown): GridObservation[] {
  const snapshot = parseEia930Snapshot(input);
  const source = `EIA-930 PACE workbook; retrieved ${snapshot.provenance.retrievedAt}`;
  return [...snapshot.rows].sort((a, b) => a.utcHourEnding.localeCompare(b.utcHourEnding)).flatMap(row => {
    const hourEnd = isoTime(row.utcHourEnding, 'utcHourEnding');
    const common = { regionId: snapshot.regionId, window: { startAt: new Date(hourEnd - HOUR).toISOString(), endAt: new Date(hourEnd).toISOString() }, observedAt: new Date(hourEnd).toISOString(), simulated: false };
    const hasImputation = Object.values(row.imputed).some(Boolean);
    const mw = (metric: 'demand' | 'generation' | 'interchange', value: number | null, imputed: boolean): GridObservation => ({
      ...common, metric, basis: EIA930_BASIS[metric], unit: 'MW', value: imputed ? null : value,
      source: imputed ? `${source}; imputed by EIA; reported value unavailable` : value === null ? `unavailable: blank reported ${metric}; ${source}` : source,
    });
    const intensity = row.consumedIntensityLbsPerKWh;
    return [
      { ...common, metric: 'consumption-carbon-intensity' as const, basis: EIA930_BASIS['consumption-carbon-intensity'], value: intensity === null ? null : lbsPerKWhToGramsPerKWh(intensity), unit: 'gCO2/kWh' as const, source: `${intensity === null ? 'unavailable: blank consumed intensity; ' : ''}${source}${hasImputation && intensity !== null ? '; intensity includes EIA-imputed inputs' : ''}` },
      mw('demand', row.demandMW, row.imputed.demand), mw('generation', row.netGenerationMW, row.imputed.netGeneration), mw('interchange', row.totalInterchangeMW, row.imputed.totalInterchange),
    ];
  });
}
export function rowsFromSheet(table: unknown[][], window: TimeWindow): Eia930Row[] {
  const [start, end] = windowBounds(window);
  const headers = table[0] ?? [];
  const columns = Object.fromEntries(Object.entries(EIA930_COLUMNS).map(([key, header]) => {
    const index = headers.indexOf(header);
    if (index === -1) throw new Error(`Missing required header: ${header}`);
    if (headers.lastIndexOf(header) !== index) throw new Error(`Duplicate header: ${header}`);
    return [key, index];
  }));
  const imputedGenerationColumns = headers.flatMap((header, index) => typeof header === 'string' && /^Imputed .+ Gen$/.test(header) ? [index] : []);
  if (!imputedGenerationColumns.length) throw new Error('Missing required headers matching /^Imputed .+ Gen$/');
  const blank = (value: unknown) => value === null || value === undefined || value === '';
  const rows: Eia930Row[] = [];
  for (const [index, cells] of table.slice(1).entries()) {
    const cell = (key: keyof typeof EIA930_COLUMNS) => cells[columns[key]];
    const serial = finite(cell('utcHourEnding'), `sheet row ${index + 2} UTC time`);
    const utcHourEnding = excelSerialToUtcIso(serial);
    const hourEnd = Date.parse(utcHourEnding);
    if (hourEnd - HOUR < start || hourEnd > end) continue;
    if (cell('regionId') !== 'PACE') throw new Error(`sheet row ${index + 2} BA must be PACE`);
    const number = (key: keyof typeof EIA930_COLUMNS) => blank(cell(key)) ? null : finite(cell(key), `${key} row ${index + 2}`);
    const date = cell('localDate');
    const localDate = typeof date === 'number' ? excelSerialToUtcIso(date).slice(0, 10) : date instanceof Date ? date.toISOString().slice(0, 10) : string(date, 'Local date');
    rows.push({ utcHourEnding, localDate, localHour: finite(cell('localHour'), 'Hour'), timeZone: string(cell('timeZone'), 'Time zone'), demandMW: number('demandMW'), netGenerationMW: number('netGenerationMW'), totalInterchangeMW: number('totalInterchangeMW'), consumedIntensityLbsPerKWh: number('consumedIntensityLbsPerKWh'), imputed: { demand: number('imputedDemand') !== null, netGeneration: number('imputedNetGeneration') !== null, totalInterchange: number('imputedTotalInterchange') !== null, generationBySource: imputedGenerationColumns.some(index => !blank(cells[index])) } });
  }
  return validateRows(rows, window);
}
