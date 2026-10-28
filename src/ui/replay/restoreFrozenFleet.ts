import { createPairedReplaySession, type ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import type { FrozenFleetSnapshot } from '../../data/FrozenFleet.type';

export type ReplaySession = ReturnType<typeof createPairedReplaySession>;

/** JSON snapshots preserve array order; object property order has no domain meaning. */
function comparableJson(value: unknown): string {
    return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

/** Rebuild mutable runtime state from its original inputs, then verify every retained fact. */
export async function restoreReplayProgress(saved: Omit<ReplayProgress, 'map'>, signal?: AbortSignal): Promise<ReplaySession> {
    signal?.throwIfAborted();
    const expected = structuredClone(saved);
    if (expected.phase === 'routed') throw new RangeError('Restore requires a settled replay capture, not in-flight routing.');
    if (!Number.isInteger(expected.hour) || expected.hour < 0 || expected.hour > expected.scenario.hours)
        throw new RangeError('Saved replay hour must be within the scenario horizon.');
    const session = createPairedReplaySession(expected.scenario);
    let rebuilt = session.read();
    while (rebuilt.hour < expected.hour && !rebuilt.done) {
        signal?.throwIfAborted();
        rebuilt = await session.step();
        // Let a browser Reset/unmount abort a long reconstruction between canonical ticks.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted();
    }
    const { map: _, ...actual } = rebuilt;
    if (comparableJson(actual) !== comparableJson(expected))
        throw new RangeError('Saved replay evidence does not match reconstruction from its captured inputs.');
    return session;
}

export function restoreFrozenFleet(snapshot: FrozenFleetSnapshot): Promise<ReplaySession> {
    if (snapshot.schemaVersion !== 1) return Promise.reject(new RangeError('Unsupported frozen fleet snapshot schema.'));
    return restoreReplayProgress(snapshot.progress);
}
