import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import readExcelFile from 'read-excel-file/node';
import { EIA930_COLUMNS, EIA930_UNITS, isoTime, parseEia930Snapshot, rowsFromSheet, windowBounds } from '../src/core/energy/data/eia930.ts';
import type { Eia930Snapshot } from '../src/core/energy/data/eia930.ts';

const sourceUrl = 'https://www.eia.gov/electricity/gridmonitor/knownissues/xls/PACE.xlsx';
async function main(): Promise<void> {
  const allowed = new Set(['--input', '--start', '--end', '--out', '--retrieved-at']);
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (args.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    args.set(flag, argv[i + 1]);
  }
  const window = { startAt: args.get('--start') ?? '2025-07-31T05:00:00Z', endAt: args.get('--end') ?? '2025-08-07T05:00:00Z' };
  const [start, end] = windowBounds(window);
  if (start % 3600000 || end % 3600000) throw new Error('Snapshot window must be hour-aligned');
  const coverage = { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
  const input = args.get('--input');
  if (input && !args.has('--retrieved-at')) throw new Error('--retrieved-at is required with --input');
  if (!input && args.has('--retrieved-at')) throw new Error('--retrieved-at is only valid with --input; downloads use retrieval time now');
  const retrievedAt = input ? new Date(isoTime(args.get('--retrieved-at'), '--retrieved-at')).toISOString() : new Date().toISOString();
  let temporaryDirectory: string | undefined;
  try {
    let workbookPath: string;
    let bytes: Buffer;
    if (input) {
      workbookPath = input;
      bytes = await readFile(input);
    } else {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`EIA download failed: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'sunchaser-eia930-'));
      workbookPath = join(temporaryDirectory, 'PACE.xlsx');
      await writeFile(workbookPath, bytes);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const sheets = await readExcelFile(workbookPath);
    const table = sheets.find(sheet => sheet.sheet === 'Published Hourly Data')?.data;
    if (!table) throw new Error('Missing sheet: Published Hourly Data');
    const rows = rowsFromSheet(table, coverage);
    const expectedHours = (end - start) / 3_600_000;
    const missingHours = expectedHours - rows.length;
    if (missingHours > 0) console.warn(`Warning: expected ${expectedHours} PACE hours in coverage, found ${rows.length}.`);
    const snapshot: Eia930Snapshot = {
      schemaVersion: 1, regionId: 'PACE',
      provenance: {
        source: 'EIA-930 PACE workbook', sourceUrl, retrievedAt, sha256, sheet: 'Published Hourly Data',
        columns: { ...EIA930_COLUMNS }, units: { ...EIA930_UNITS },
        imputedGenerationColumns: table[0].filter((header): header is string => typeof header === 'string' && /^Imputed .+ Gen$/.test(header)),
        notes: [
          'EIA preliminary data are published as-is and may be revised; this snapshot preserves the retrieved workbook.',
          'UTC time is the end of the hour. Each observation covers [hour end minus one hour, hour end).',
          'Demand, net generation and total interchange are published hourly MWh, equivalent to average MW over that hour.',
          'Consumed electricity CO2 intensity is published in lbs/kWh and includes interchange; runtime conversion to gCO2/kWh multiplies by 453.59237.',
          'Positive total interchange means net exports; negative means net imports.',
          'Reported blanks remain null. EIA-imputed values are flagged and withheld from reported MW observations.',
          'Regional evidence does not establish site hardware, compute capacity or permission to consume energy.',
          ...(missingHours > 0 ? [`Missing ${missingHours} of ${expectedHours} hours in coverage; missing hours are unavailable at runtime.`] : []),
        ],
      },
      coverage, rows,
    };
    if (!snapshot.rows.length) throw new Error('No PACE hours found in the requested window');
    const validated = parseEia930Snapshot(snapshot);
    const output = args.get('--out') ?? `src/core/energy/data/snapshots/eia930-pace-${coverage.startAt.slice(0, 10)}_${coverage.endAt.slice(0, 10)}.json`;
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(validated, null, 2)}\n`);
    console.log(`Wrote ${validated.rows.length} PACE hours to ${output}; workbook SHA-256 ${sha256}`);
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
