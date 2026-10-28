import { expect, test } from 'vitest';
import { admitLocalRun } from '../../../src/server/jobs/admitLocalRun';
import { parseEiaApiResponse } from '../../../src/core/energy/data/eiaApi';
import { parseCaisoCsv } from '../../../src/server/caiso';
import { snapshotRevision } from '../../../src/server/snapshotRevision';
import type { StoredSnapshot } from '../../../src/server/SnapshotStore.type';
import type { LocalRunPolicy } from '../../../src/data/LocalRun.type';

const context = { asOf: '2026-10-28T08:03:00.000Z', evaluatedAt: '2026-10-28T08:03:01.000Z', workerAvailable: true };
const policy: LocalRunPolicy = { maximumDemandMW: 6000, maximumWholesaleUsdPerMWh: 75, maximumAgeMinutes: { eia: 180, caiso: 20 } };
function record<T>(snapshot: T): StoredSnapshot<T> {
  return { revision: snapshotRevision(snapshot), snapshot, evidence: { format: 'test', body: {} } };
}
function inputs(demand: number | null = 5429, price = 42) {
  return {
    eia: record(parseEiaApiResponse({ response: {
      frequency: 'hourly', dateFormat: 'YYYY-MM-DD"T"HH24', total: '2', data: [
        { period: '2026-10-28T06', respondent: 'PACE', type: 'D', value: 5100, 'value-units': 'megawatthours' },
        { period: '2026-10-28T07', respondent: 'PACE', type: 'D', value: demand, 'value-units': 'megawatthours' },
      ],
    } }, '2026-10-28T08:01:00.000Z')),
    caiso: record(parseCaisoCsv('INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,NODE_ID,MARKET_RUN_ID,LMP_TYPE,VALUE\n' +
      `2026-10-28T08:00:00Z,2026-10-28T08:05:00Z,ELAP_PACE-APND,RTM,LMP,${price}\n` +
      '2026-10-28T08:05:00Z,2026-10-28T08:10:00Z,ELAP_PACE-APND,RTM,LMP,999\n', '2026-10-28T08:01:00.000Z')),
  };
}

test('admits actual reported demand and the latest started price, preserving evidence and delayed observation age', () => {
  const supplied = inputs();
  const result = admitLocalRun(supplied, policy, context);
  expect(result).toMatchObject({ scheduler: 'public-input-local-v1', action: 'run', executionLocation: 'Application server', asOf: context.asOf, evaluatedAt: context.evaluatedAt });
  expect(result.inputs).toEqual([
    { feed: 'eia', revision: supplied.eia.revision, sourceUrl: supplied.eia.snapshot.sourceUrl, retrievedAt: '2026-10-28T08:01:00.000Z', interval: { startAt: '2026-10-28T06:00:00.000Z', endAt: '2026-10-28T07:00:00.000Z' }, value: 5429, unit: 'MW', ageMinutes: 63, maximumAgeMinutes: 180, accepted: true },
    { feed: 'caiso', revision: supplied.caiso.revision, sourceUrl: supplied.caiso.snapshot.sourceUrl, retrievedAt: '2026-10-28T08:01:00.000Z', interval: { startAt: '2026-10-28T08:00:00.000Z', endAt: '2026-10-28T08:05:00.000Z' }, value: 42, unit: 'USD/MWh', ageMinutes: 0, maximumAgeMinutes: 20, accepted: true },
  ]);
});

test('changing a demand limit changes the actual admission decision and equality is allowed', () => {
  const supplied = inputs();
  expect(admitLocalRun(supplied, { ...policy, maximumDemandMW: 5429 }, context).action).toBe('run');
  const limited = admitLocalRun(supplied, { ...policy, maximumDemandMW: 5428 }, context);
  expect(limited.action).toBe('wait');
  expect(limited.inputs[0].accepted).toBe(false);
  expect(limited.explanation).toMatch(/demand/i);
});

test('signed prices and negative limits are valid and affect admission without clamping', () => {
  const supplied = inputs(5429, -7.125);
  const allowed = admitLocalRun(supplied, { ...policy, maximumWholesaleUsdPerMWh: -7.125 }, context);
  expect(allowed.action).toBe('run');
  expect(allowed.inputs[1].value).toBe(-7.125);
  const limited = admitLocalRun(supplied, { ...policy, maximumWholesaleUsdPerMWh: -8 }, context);
  expect(limited.action).toBe('wait');
  expect(limited.inputs[1].accepted).toBe(false);
});

test('an occupied local worker waits even when both public inputs pass', () => {
  const decision = admitLocalRun(inputs(), policy, { ...context, workerAvailable: false });
  expect(decision.action).toBe('wait');
  expect(decision.inputs.every(input => input.accepted)).toBe(true);
  expect(decision.explanation).toMatch(/worker/i);
});

test('a known missing latest demand cannot silently fall back to the earlier numeric hour', () => {
  const decision = admitLocalRun(inputs(null), policy, context);
  expect(decision.action).toBe('unavailable');
  expect(decision.inputs.some(input => input.feed === 'eia')).toBe(false);
  expect(decision.explanation).toMatch(/demand/i);
});

test('an observation exactly at its age limit is usable but one minute older is unavailable', () => {
  const supplied = inputs();
  expect(admitLocalRun(supplied, { ...policy, maximumAgeMinutes: { eia: 63, caiso: 20 } }, context).action).toBe('run');
  const stale = admitLocalRun(supplied, { ...policy, maximumAgeMinutes: { eia: 62, caiso: 20 } }, context);
  expect(stale.action).toBe('unavailable');
  expect(stale.inputs[0]).toMatchObject({ ageMinutes: 63, accepted: false });
});

test('a fresh retrieval does not make an expired CAISO interval fresh', () => {
  const supplied = inputs();
  supplied.caiso.snapshot.prices = [{ window: { startAt: '2026-10-28T07:35:00.000Z', endAt: '2026-10-28T07:40:00.000Z' }, usdPerMWh: 42 }];
  supplied.caiso = record(supplied.caiso.snapshot);
  const result = admitLocalRun(supplied, policy, context);
  expect(result.action).toBe('unavailable');
  expect(result.inputs[1]).toMatchObject({ ageMinutes: 23, accepted: false });
});

test('missing records and a record changed after hashing are unavailable', () => {
  const supplied = inputs();
  expect(admitLocalRun({ ...supplied, eia: null }, policy, context).action).toBe('unavailable');
  supplied.eia.snapshot.observations[1].value = 100;
  const changed = admitLocalRun(supplied, policy, context);
  expect(changed.action).toBe('unavailable');
  expect(changed.explanation).toMatch(/revision/i);
});

test('future retrieval and future actual observations cannot inform the decision', () => {
  const futureRetrieval = inputs();
  futureRetrieval.caiso.snapshot.retrievedAt = '2026-10-28T08:04:00.000Z';
  futureRetrieval.caiso = record(futureRetrieval.caiso.snapshot);
  expect(admitLocalRun(futureRetrieval, policy, context).action).toBe('unavailable');
  const futureObservation = inputs();
  futureObservation.eia.snapshot.observations[1].observedAt = '2026-10-28T08:04:00.000Z';
  futureObservation.eia = record(futureObservation.eia.snapshot);
  expect(admitLocalRun(futureObservation, policy, context).action).toBe('unavailable');
});

test('a price that has not started is never used when no eligible price exists', () => {
  const supplied = inputs();
  supplied.caiso.snapshot.prices.shift();
  supplied.caiso = record(supplied.caiso.snapshot);
  expect(admitLocalRun(supplied, policy, context).action).toBe('unavailable');
});

test('simulated demand, invalid policy, and a future as-of time are unavailable', () => {
  const simulated = inputs();
  simulated.eia.snapshot.observations[1].simulated = true;
  simulated.eia = record(simulated.eia.snapshot);
  expect(admitLocalRun(simulated, policy, context).action).toBe('unavailable');
  expect(admitLocalRun(inputs(), { ...policy, maximumDemandMW: Number.NaN }, context).action).toBe('unavailable');
  expect(admitLocalRun(inputs(), { ...policy, maximumAgeMinutes: { eia: -1, caiso: 20 } }, context).action).toBe('unavailable');
  expect(admitLocalRun(inputs(), policy, { ...context, asOf: '2026-10-28T08:04:00.000Z' }).action).toBe('unavailable');
});
