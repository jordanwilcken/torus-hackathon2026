import { expect, test } from 'vitest';
import streamInputs from '../../../../examples/replay/job-stream.json';
import type { ReplayScenario } from '../../../../src/core/execution/replay/Replay.types';
import { createPairedReplaySession, type ReplayProgress } from '../../../../src/core/execution/replay/createPairedReplaySession';
import type { FrozenFleetSnapshot, FleetSourceBundle } from '../../../../src/data/FrozenFleet.type';
import { restoreFrozenFleet, restoreReplayProgress, type ReplaySession } from '../../../../src/ui/replay/restoreFrozenFleet';

const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function savedProgress(session: ReplaySession): Omit<ReplayProgress, 'map'> {
    const { map: _, ...progress } = session.read();
    return jsonCopy(progress);
}
async function pausedStream(): Promise<ReplaySession> {
    const session = createPairedReplaySession(structuredClone(streamInputs) as ReplayScenario);
    await session.step();
    session.schedule({ atHour: 1, kind: 'solar-drop', payload: { locationId: 'A' } });
    await session.step();
    return session;
}
function frozen(progress: Omit<ReplayProgress, 'map'>): FrozenFleetSnapshot {
    const sources: FleetSourceBundle = {
        capturedAt: '2026-10-28T18:00:00Z', weather: null, eia: null,
        caiso: { revision: 'original-price', status: 'ready', snapshot: {
            source: 'CAISO', sourceUrl: 'https://oasis.caiso.com', node: 'ELAP_PACE-APND',
            retrievedAt: '2026-10-28T18:00:00Z', prices: [{
                window: { startAt: '2026-10-28T18:00:00Z', endAt: '2026-10-28T18:05:00Z' }, usdPerMWh: 30,
            }],
        } },
    };
    return { schemaVersion: 1, capturedAt: '2026-10-28T20:00:00Z', runInputs: sources,
        latestContext: structuredClone(sources), progress };
}
async function finish(session: ReplaySession) {
    while (!session.read().done) await session.step();
    return session.result();
}

test('a frozen paused stream restores the same receipts and can continue to the identical final evidence', async () => {
    const original = await pausedStream();
    const snapshot = frozen(savedProgress(original));
    const restored = await restoreFrozenFleet(snapshot);
    expect(savedProgress(restored)).toEqual(snapshot.progress);
    expect(restored.read().hour).toBe(2);
    expect(restored.read().map.sites.size).toBe(2);
    expect(restored.read().selected.run.ticks[1].meters.find(meter => meter.locationId === 'A')?.solarKWh).toBe(0);
    expect(await finish(restored)).toEqual(await finish(original));
});

test('JSON object property order does not change the restored state', async () => {
    const original = await pausedStream();
    const saved = savedProgress(original);
    const reordered = JSON.parse(JSON.stringify(saved, (_, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).reverse()) : value));
    expect(savedProgress(await restoreReplayProgress(reordered))).toEqual(saved);
});

test('a newer source context never replaces the captured scenario or its receipts', async () => {
    const original = await pausedStream();
    const snapshot = frozen(savedProgress(original));
    snapshot.latestContext.capturedAt = '2026-10-28T22:00:00Z';
    snapshot.latestContext.caiso!.revision = 'newer-price';
    snapshot.latestContext.caiso!.snapshot.prices[0].usdPerMWh = 999;
    const before = jsonCopy(snapshot);
    const restored = await restoreFrozenFleet(snapshot);
    expect(restored.read().scenario).toEqual(before.progress.scenario);
    expect(restored.read().selected.run.ticks).toEqual(before.progress.selected.run.ticks);
    expect(snapshot).toEqual(before);
});

test('tampered execution receipts are rejected rather than accepted as a restorable state', async () => {
    const saved = savedProgress(await pausedStream());
    saved.selected.run.ticks[1].executions.find(receipt => receipt.jobId === 'job-01')!.computeKWh += 10;
    await expect(restoreReplayProgress(saved)).rejects.toThrow('does not match');
});

test('legacy captures without stored burdens restore and gain reconstructed inventory evidence', async () => {
    const saved = savedProgress(await pausedStream());
    const additions = ['initialStoredCarbonKg', 'endingStoredCarbonKg', 'initialStoredElectricityUsd', 'endingStoredElectricityUsd'];
    const legacy = JSON.parse(JSON.stringify(saved, (key, value) => additions.includes(key) ? undefined : value));
    delete legacy.baseline.impact.carbonPriceUsdPerTonne;
    delete legacy.selected.impact.carbonPriceUsdPerTonne;
    expect(savedProgress(await restoreReplayProgress(legacy))).toEqual(saved);
});

test('a supplied stored carbon receipt must match reconstruction', async () => {
    const saved = savedProgress(await pausedStream());
    saved.selected.run.ticks[0].meters[0].endingStoredCarbonKg = 99;
    await expect(restoreReplayProgress(saved)).rejects.toThrow('does not match');
});

test('legacy burden compatibility does not allow omitting the existing cost policy', async () => {
    const saved = savedProgress(await pausedStream());
    delete (saved.selected.run.costPolicy as Partial<NonNullable<typeof saved.selected.run.costPolicy>>).carbonPriceUsdPerTonne;
    await expect(restoreReplayProgress(saved)).rejects.toThrow('does not match');
});

test('an in-flight routed capture cannot be restored as if its dispatch had settled', async () => {
    const session = createPairedReplaySession(structuredClone(streamInputs) as ReplayScenario);
    let routed!: Omit<ReplayProgress, 'map'>;
    await session.step(progress => { const { map: _, ...rest } = progress; routed = jsonCopy(rest); });
    expect(routed.phase).toBe('routed');
    await expect(restoreReplayProgress(routed)).rejects.toThrow('settled');
});

test.each([-1, 1.5, 5])('invalid saved model hour %s is rejected', async hour => {
    const saved = savedProgress(await pausedStream());
    await expect(restoreReplayProgress({ ...saved, hour })).rejects.toThrow('hour');
});

test('a phase inconsistent with the reconstructed hour is rejected', async () => {
    const saved = savedProgress(await pausedStream());
    await expect(restoreReplayProgress({ ...saved, phase: 'complete' })).rejects.toThrow('does not match');
});

test('an already aborted restore does not construct an invalid scenario', async () => {
    const saved = savedProgress(await pausedStream());
    saved.scenario.sites = [];
    const controller = new AbortController();
    controller.abort();
    await expect(restoreReplayProgress(saved, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

test('an abort between replay ticks stops restoration before returning a session', async () => {
    const original = await pausedStream();
    await finish(original);
    const controller = new AbortController();
    const pending = restoreReplayProgress(savedProgress(original), controller.signal);
    const timer = setTimeout(() => controller.abort(), 0);
    try { await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); }
    finally { clearTimeout(timer); }
});
