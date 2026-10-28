import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Eia930Snapshot } from '../../../../src/core/energy/data/eia930.js';
import { snapshotGrid } from '../../../../src/core/energy/data/sites.js';
import { parseEia930Snapshot, observationsFromSnapshot } from '../../../../src/core/energy/data/eia930.js';
import { expectedBasis } from './fixture.js';

const path = 'src/core/energy/data/snapshots/eia930-pace-2025-07-31_2025-08-07.json';
describe('committed real EIA-930 snapshot', () => {
  it('labels every metric with one declared basis per hour, distinct by label from the illustrative fake forecast', () => {
    const snapshot = parseEia930Snapshot(JSON.parse(readFileSync(path, 'utf8')));
    const actual = snapshotGrid().read('PACE', snapshot.coverage).observations;
    const intensity = actual.filter(o => o.metric === 'consumption-carbon-intensity');
    const fake = JSON.parse(readFileSync('test/fixtures/legacy/energy/forecasts.json', 'utf8')) as { forecasts: { PACE: { carbon: { basis: string } } } };
    expect(actual).toHaveLength(672);
    expect(intensity).toHaveLength(168);
    for (const metric of Object.keys(expectedBasis) as (keyof typeof expectedBasis)[]) {
      const ofMetric = actual.filter(o => o.metric === metric);
      expect(ofMetric).toHaveLength(168);
      expect(new Set(ofMetric.map(o => o.basis))).toEqual(new Set([expectedBasis[metric]]));
      expect(new Set(ofMetric.map(o => o.unit))).toEqual(new Set([metric === 'consumption-carbon-intensity' ? 'gCO2/kWh' : 'MW']));
    }
    expect(intensity.every(o => o.unit === 'gCO2/kWh')).toBe(true);
    expect(actual.some(o => o.metric === 'generation-carbon-intensity')).toBe(false);
    expect(actual.some(o => o.unit === 'gCO2e/kWh')).toBe(false);
    expect(fake.forecasts.PACE.carbon.basis).toBe('Illustrative average operational CO2; not an EIA measurement');
    expect(intensity[0].basis).not.toBe(fake.forecasts.PACE.carbon.basis);
  });
  it('commits an explicit clean per-fuel imputation flag for every hour', () => {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as Eia930Snapshot;
    expect(snapshot.rows.every(row => row.imputed.generationBySource === false)).toBe(true);
  });
  it.each([
    ['2025-07-31T06:00:00.000Z', 6895, 8200, 1305, 1.4141296396480794],
    ['2025-08-03T20:00:00.000Z', 7613, 7835, 222, 0.94782748885189216],
    ['2025-08-07T05:00:00.000Z', 7645, 7616, -29, 1.4205515729763465],
  ])('pins independent workbook values at %s', (utcHourEnding, demandMW, netGenerationMW, totalInterchangeMW, consumedIntensityLbsPerKWh) => {
    const snapshot = parseEia930Snapshot(JSON.parse(readFileSync(path, 'utf8')));
    expect(snapshot.rows.find(row => row.utcHourEnding === utcHourEnding)).toMatchObject({ demandMW, netGenerationMW, totalInterchangeMW, consumedIntensityLbsPerKWh });
  });
  it('replays the golden consumed intensity in the preceding hour', () => {
    const actual = snapshotGrid().read('PACE', { startAt: '2025-08-03T19:00:00Z', endAt: '2025-08-03T20:00:00Z' });
    expect(actual.observations.find(o => o.metric === 'consumption-carbon-intensity')?.value).toBeCloseTo(0.94782748885189216 * 453.59237, 3);
  });
  it('contains precisely 168 clean reported hours and the documented provenance', () => {
    expect(existsSync(path)).toBe(true);
    const snapshot = parseEia930Snapshot(JSON.parse(readFileSync(path, 'utf8')));
    expect(snapshot.rows).toHaveLength(168);
    expect(snapshot.regionId).toBe('PACE');
    expect(snapshot.coverage).toEqual({ startAt: '2025-07-31T05:00:00.000Z', endAt: '2025-08-07T05:00:00.000Z' });
    expect(snapshot.rows[0].utcHourEnding).toBe('2025-07-31T06:00:00.000Z');
    expect(snapshot.rows[167].utcHourEnding).toBe('2025-08-07T05:00:00.000Z');
    expect(snapshot.provenance).toMatchObject({ retrievedAt: '2026-10-27T22:16:00.000Z', sheet: 'Published Hourly Data', units: { consumedIntensityLbsPerKWh: 'lbs/kWh' } });
    const intensities: number[] = [];
    for (const row of snapshot.rows) {
      expect(row.imputed).toEqual({ demand: false, netGeneration: false, totalInterchange: false, generationBySource: false });
      expect(Number.isFinite(row.consumedIntensityLbsPerKWh)).toBe(true);
      expect(row.consumedIntensityLbsPerKWh).toBeGreaterThanOrEqual(0.775499);
      expect(row.consumedIntensityLbsPerKWh).toBeLessThanOrEqual(1.759062);
      expect(row.demandMW).toBeGreaterThanOrEqual(5259);
      expect(row.demandMW).toBeLessThanOrEqual(9243);
      expect(Number.isFinite(row.netGenerationMW)).toBe(true);
      expect(Number.isFinite(row.totalInterchangeMW)).toBe(true);
      intensities.push(row.consumedIntensityLbsPerKWh!);
    }
    expect(Math.min(...intensities)).toBeCloseTo(0.775499, 6);
    expect(Math.max(...intensities)).toBeCloseTo(1.759062, 6);
    const observations = observationsFromSnapshot(snapshot);
    expect(observations).toHaveLength(672);
    expect(observations[0].value).toBe(snapshot.rows[0].consumedIntensityLbsPerKWh! * 453.59237);
    for (const o of observations) expect(o.simulated).toBe(false);
  });
});
