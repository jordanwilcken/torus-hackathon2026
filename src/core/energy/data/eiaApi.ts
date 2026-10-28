import type { GridObservation } from '../GridObservation.interface.js';
import type { SlotForecast } from '../SlotForecast.type.js';
import type { ForecastPoint } from '../ForecastPoint.type.js';
import { EIA930_BASIS, isoTime } from './eia930.js';

export type EiaApiSnapshot = {
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  regionId: 'PACE';
  observations: GridObservation[];
  forecast: SlotForecast;
};

const HOUR = 3_600_000;
const SOURCE_URL = 'https://api.eia.gov/v2/electricity/rto/region-data/data/';
const SERIES = ['D', 'NG', 'TI', 'DF'] as const;
type Series = typeof SERIES[number];
const METRICS = { D: 'demand', NG: 'generation', TI: 'interchange' } as const;

function object(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertNoApiErrors(value: Record<string, unknown>): void {
  if (['error', 'errors', 'warning', 'warnings'].some(field => value[field] !== undefined)) {
    throw new Error('EIA API reported an error or warning');
  }
}

function totalRows(value: unknown): number {
  const count = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid EIA API row count');
  return count;
}

function reportedValue(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'string' && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value.trim()) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw new Error('Invalid EIA API row');
  return parsed;
}

function parseRow(value: unknown): { type: Series; value: number | null; hourEnd: number } {
  const row = object(value, 'Invalid EIA API row');
  if (row.respondent !== 'PACE' || row['value-units'] !== 'megawatthours' || !SERIES.includes(row.type as Series)) {
    throw new Error('Invalid EIA API row');
  }
  // The API's hourly frequency is UTC; local-hourly is rejected at the response boundary.
  if (typeof row.period !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/.test(row.period)) throw new Error('Invalid EIA API row');
  const hourEnd = Date.parse(`${row.period}:00:00Z`);
  if (!Number.isFinite(hourEnd) || new Date(hourEnd).toISOString().slice(0, 13) !== row.period) throw new Error('Invalid EIA API row');
  return { type: row.type as Series, value: reportedValue(row.value), hourEnd };
}

/** Normalizes one complete, bounded UTC API response. Request metadata is deliberately excluded. */
export function parseEiaApiResponse(payload: unknown, retrievedAt: string): EiaApiSnapshot {
  try {
    retrievedAt = new Date(isoTime(retrievedAt, 'retrievedAt')).toISOString();
  } catch {
    throw new Error('Invalid EIA API retrieval timestamp');
  }
  const root = object(payload, 'Invalid EIA API response');
  assertNoApiErrors(root);
  const response = object(root.response, 'Invalid EIA API response');
  assertNoApiErrors(response);
  if (response.frequency !== 'hourly' || response.dateFormat !== 'YYYY-MM-DD"T"HH24') throw new Error('Invalid EIA API UTC hourly metadata');
  if (!Array.isArray(response.data) || response.data.length === 0) throw new Error('EIA API response contains no data');
  if (totalRows(response.total) !== response.data.length) throw new Error('Incomplete EIA API response');

  const rows = response.data.map(parseRow).sort((a, b) => a.hourEnd - b.hourEnd || SERIES.indexOf(a.type) - SERIES.indexOf(b.type));
  const retrievedTime = Date.parse(retrievedAt);
  const seen = new Set<string>();
  const source = `EIA-930 PACE API; retrieved ${retrievedAt}`;
  const observations: GridObservation[] = [];
  const demandPoints: ForecastPoint[] = [];
  let hasDemandForecast = false;
  for (const row of rows) {
    const identity = `${row.hourEnd}:${row.type}`;
    if (seen.has(identity)) throw new Error('Duplicate EIA API metric period');
    seen.add(identity);
    const window = { startAt: new Date(row.hourEnd - HOUR).toISOString(), endAt: new Date(row.hourEnd).toISOString() };
    if (row.type === 'DF') {
      hasDemandForecast = true;
      // ForecastPoint has no null representation: a missing report leaves a gap, never zero.
      if (row.value !== null) demandPoints.push({ window, value: row.value });
      continue;
    }
    if (row.hourEnd > retrievedTime) throw new Error('EIA API observation is in the future');
    const metric = METRICS[row.type];
    observations.push({
      regionId: 'PACE', metric, value: row.value, unit: 'MW', window,
      source: row.value === null ? `unavailable: blank reported ${metric}; ${source}` : source,
      basis: EIA930_BASIS[metric], observedAt: window.endAt, simulated: false,
    });
  }
  const forecast: SlotForecast = hasDemandForecast ? { demand: {
    source, scope: 'PACE',
    basis: 'EIA-930 reported day-ahead balancing-authority demand forecast; hourly MWh expressed as average MW; not a carbon forecast',
    unit: 'MW', retrievedAt, simulated: false, points: demandPoints,
  } } : {};
  return { source, sourceUrl: SOURCE_URL, retrievedAt, regionId: 'PACE', observations, forecast };
}
