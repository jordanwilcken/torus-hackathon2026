import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Eia930Snapshot } from '../../../../src/core/energy/data/eia930.js';
import { describe, expect, it } from 'vitest';

describe('snapshot CLI validation before workbook I/O', () => {
  it.each([
    [['--input', '/does-not-exist.xlsx'], /--retrieved-at.*required/],
    [['--unknown', 'x'], /unknown option.*--unknown/i],
    [['--input'], /missing value.*--input/i],
    [['--start', 'bad', '--end', '2025-08-07T05:00:00Z'], /Invalid window/],
  ])('rejects invalid arguments %j', (args, expected) => {
    const result = spawnSync(process.execPath, ['scripts/fetch-eia930-snapshot.ts', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
  });
});

describe('snapshot CLI coverage and provenance', () => {
  it.each([1, 2])('reports completeness for %s of 2 requested hours without failing', count => {
    const directory = mkdtempSync(join(tmpdir(), 'eia930-snapshot-test-'));
    try {
      const input = join(directory, 'fixture.xlsx');
      const output = join(directory, 'snapshot.json');
      const hook = join(directory, 'parser.mjs');
      const headers = ['BA', 'UTC time', 'Local date', 'Hour', 'Time zone', 'Demand', 'Net generation', 'Total interchange', 'CO2 Emissions Intensity for Consumed Electricity', 'Imputed demand', 'Imputed net generation', 'Imputed total interchange', 'Imputed NG Gen', 'Unrelated', 'Imputed OTH Gen'];
      const rows = [['PACE', 45869.25, 45869, 1, 'MDT', 6000, 6100, 100, 1, null, null, null, null, null, null], ['PACE', 45869.291666666664, 45869, 2, 'MDT', 6001, 6101, 100, 1, null, null, null, null, null, null]].slice(0, count);
      const parser = `export default async () => ${JSON.stringify([{ sheet: 'Published Hourly Data', data: [headers, ...rows] }])};`;
      writeFileSync(input, 'Hand-written test bytes; workbook parsing is replaced by a Node module hook.');
      writeFileSync(hook, `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { return specifier === 'read-excel-file/node' ? { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(parser))}, shortCircuit: true } : next(specifier, context); } });`);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, 'scripts/fetch-eia930-snapshot.ts', '--input', input, '--retrieved-at', '2026-10-27T22:16:00Z', '--start', '2025-07-31T05:00:00Z', '--end', '2025-07-31T07:00:00Z', '--out', output], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      const snapshot = JSON.parse(readFileSync(output, 'utf8')) as Eia930Snapshot;
      expect(snapshot.rows).toHaveLength(count);
      expect(snapshot.provenance.imputedGenerationColumns).toEqual(['Imputed NG Gen', 'Imputed OTH Gen']);
      if (count === 1) {
        expect(result.stderr).toMatch(/warning.*expected 2.*found 1/i);
        expect(snapshot.provenance.notes).toContain('Missing 1 of 2 hours in coverage; missing hours are unavailable at runtime.');
      } else {
        expect(result.stderr).toBe('');
        expect(snapshot.provenance.notes.some(note => note.startsWith('Missing '))).toBe(false);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
