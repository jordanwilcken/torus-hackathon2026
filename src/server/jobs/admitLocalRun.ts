import type { LocalRunDecision, LocalRunPolicy, PublicRunInput } from '../../data/LocalRun.type.ts';
import type { EiaApiSnapshot } from '../../core/energy/data/eiaApi.ts';
import type { CaisoSnapshot } from '../caiso.ts';
import type { StoredSnapshot } from '../SnapshotStore.type.ts';
import { snapshotRevision } from '../snapshotRevision.ts';
import { isoTime } from '../../core/energy/data/eia930.ts';

type Interval = { startAt: string; endAt: string };
type Reading = { value: number; interval: Interval; end: number };
type InspectedInput = { input?: PublicRunInput; unavailable?: string; waiting?: string };
const minute = 60_000;

/** A local CPU admission policy using public regional context, not site capacity or GPU telemetry. */
export function admitLocalRun(
  records: { eia: StoredSnapshot<EiaApiSnapshot> | null; caiso: StoredSnapshot<CaisoSnapshot> | null },
  policy: LocalRunPolicy,
  context: { asOf: string; evaluatedAt: string; workerAvailable: boolean },
): LocalRunDecision {
  const decision = (action: LocalRunDecision['action'], explanation: string, inputs: PublicRunInput[] = []): LocalRunDecision => ({
    scheduler: 'public-input-local-v1', asOf: context.asOf, evaluatedAt: context.evaluatedAt,
    action, executionLocation: 'This computer', explanation, inputs,
    policy: structuredClone(policy),
  });
  let asOf: number;
  try {
    validatePolicy(policy);
    asOf = isoTime(context.asOf, 'asOf');
    if (asOf > isoTime(context.evaluatedAt, 'evaluatedAt')) throw new Error('Decision asOf is in the future');
    if (typeof context.workerAvailable !== 'boolean') throw new Error('Local worker availability is unknown');
  } catch (error) {
    return decision('unavailable', error instanceof Error ? error.message : 'Invalid local admission context');
  }

  const eia = inspectInput('eia', records.eia, policy.maximumDemandMW, policy.maximumAgeMinutes.eia, asOf, selectDemand);
  const caiso = inspectInput('caiso', records.caiso, policy.maximumWholesaleUsdPerMWh, policy.maximumAgeMinutes.caiso, asOf,
    snapshot => selectPrice(snapshot, asOf));
  const inspected = [eia, caiso];
  const inputs = inspected.flatMap(result => result.input ? [result.input] : []);
  const unavailable = inspected.flatMap(result => result.unavailable ? [result.unavailable] : []);
  if (unavailable.length) return decision('unavailable', unavailable.join('; '), inputs);
  const waiting = inspected.flatMap(result => result.waiting ? [result.waiting] : []);
  if (!context.workerAvailable) waiting.push('The local worker is occupied');
  if (waiting.length) return decision('wait', waiting.join('; '), inputs);
  return decision('run', 'Reported regional demand and wholesale price meet the configured local policy; the local worker is available', inputs);
}

function validatePolicy(policy: LocalRunPolicy): void {
  if (!policy || !Number.isFinite(policy.maximumDemandMW) || policy.maximumDemandMW < 0 ||
    !Number.isFinite(policy.maximumWholesaleUsdPerMWh) ||
    !Number.isFinite(policy.maximumAgeMinutes?.eia) || policy.maximumAgeMinutes.eia <= 0 ||
    !Number.isFinite(policy.maximumAgeMinutes?.caiso) || policy.maximumAgeMinutes.caiso <= 0) {
    throw new Error('Local policy requires finite demand and price limits and positive finite age limits');
  }
}

function inspectInput<T extends { retrievedAt: string; sourceUrl: string }>(
  feed: PublicRunInput['feed'], record: StoredSnapshot<T> | null,
  limit: number, maximumAgeMinutes: number, asOf: number,
  select: (snapshot: T, retrievedAt: number) => Reading,
): InspectedInput {
  if (!record) return { unavailable: `${feed.toUpperCase()} source record is missing` };
  try {
    if (!/^[a-f0-9]{64}$/.test(record.revision) || snapshotRevision(record.snapshot) !== record.revision) {
      throw new Error(`${feed.toUpperCase()} source revision does not match its snapshot`);
    }
    const snapshot = record.snapshot;
    const retrievedAt = isoTime(snapshot.retrievedAt, `${feed.toUpperCase()} retrieval`);
    if (retrievedAt > asOf) throw new Error(`${feed.toUpperCase()} retrieval is in the future relative to asOf`);
    if (typeof snapshot.sourceUrl !== 'string' || !snapshot.sourceUrl) throw new Error(`${feed.toUpperCase()} source URL is missing`);
    const reading = select(snapshot, retrievedAt);
    const ageMinutes = Math.max(0, (asOf - reading.end) / minute);
    const input: PublicRunInput = {
      feed, revision: record.revision, sourceUrl: snapshot.sourceUrl, retrievedAt: snapshot.retrievedAt,
      interval: { ...reading.interval }, value: reading.value, unit: feed === 'eia' ? 'MW' : 'USD/MWh',
      ageMinutes, maximumAgeMinutes, accepted: false,
    };
    // Observation age is independent of retrieval age: re-fetching old data cannot make it current.
    if (ageMinutes > maximumAgeMinutes || (asOf - retrievedAt) / minute > maximumAgeMinutes) {
      return { input, unavailable: `${feed.toUpperCase()} evidence exceeds the configured age limit` };
    }
    if (reading.value > limit) {
      return { input, waiting: `${feed === 'eia' ? 'Reported regional demand' : 'Wholesale reference price'} exceeds the configured limit` };
    }
    input.accepted = true;
    return { input };
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : `${feed.toUpperCase()} evidence is invalid` };
  }
}

function intervalTimes(interval: Interval, duration: number): { start: number; end: number } {
  const start = isoTime(interval.startAt, 'Interval start');
  const end = isoTime(interval.endAt, 'Interval end');
  if (end - start !== duration || start % duration !== 0) throw new Error('Source interval is invalid');
  return { start, end };
}

function selectDemand(snapshot: EiaApiSnapshot, retrievedAt: number): Reading {
  if (snapshot.regionId !== 'PACE') throw new Error('EIA demand region is not PACE');
  let latest: { reading: Reading | null; end: number } | undefined;
  const periods = new Set<number>();
  for (const observation of snapshot.observations.filter(row => row.metric === 'demand')) {
    const { end } = intervalTimes(observation.window, 60 * minute);
    const observedAt = isoTime(observation.observedAt, 'EIA observation');
    if (observation.regionId !== 'PACE' || observation.unit !== 'MW' || observation.simulated !== false ||
      observedAt < end || observedAt > retrievedAt || periods.has(end) ||
      (observation.value !== null && (!Number.isFinite(observation.value) || observation.value < 0))) {
      throw new Error('EIA demand observation is invalid, simulated, duplicated, or in the future');
    }
    periods.add(end);
    if (!latest || end > latest.end) {
      latest = { end, reading: observation.value === null ? null : { value: observation.value, interval: observation.window, end } };
    }
  }
  // Select the latest hour before checking its value. A known missing latest hour must not become an older value.
  if (!latest?.reading) throw new Error('Latest EIA reported demand is missing');
  return latest.reading;
}

function selectPrice(snapshot: CaisoSnapshot, asOf: number): Reading {
  if (snapshot.node !== 'ELAP_PACE-APND') throw new Error('CAISO price node is not the PACE reference node');
  let latest: { reading: Reading; start: number } | undefined;
  const periods = new Set<number>();
  for (const price of snapshot.prices) {
    const { start, end } = intervalTimes(price.window, 5 * minute);
    if (!Number.isFinite(price.usdPerMWh) || periods.has(start)) throw new Error('CAISO wholesale price is invalid or duplicated');
    periods.add(start);
    if (start <= asOf && (!latest || start > latest.start)) {
      latest = { start, reading: { value: price.usdPerMWh, interval: price.window, end } };
    }
  }
  if (!latest) throw new Error('No CAISO price interval has started at asOf');
  return latest.reading;
}
