import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import type { SlotForecast } from "../../energy/SlotForecast.type.js";
import type { SlotReference } from "../../energy/SlotReference.type.js";
import type { SlotSnapshot } from "../../energy/SlotSnapshot.type.js";

function instant(value: string): number {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new RangeError(`Invalid timestamp: ${value}`);
    return time;
}

/**
 * Planning view of a map as of `fence` (the tick start). Each read is limited to the earlier of its
 * own asOf and the fence, and evidence stamped after that is withheld, using each item's own
 * observedAt / issuedAt rather than its window: regional actuals are hour-ending, but a site slot
 * observed exactly at the fence is already known. Undated slot evidence cannot prove it is not from
 * the future, so it is withheld. The wrapped map is not trusted to apply asOf itself.
 */
export function fenceEnergyMap(map: EnergyMap, fence: string): EnergyMap {
    const limit = instant(fence);
    const clamp = (asOf: string) => instant(asOf) > limit ? fence : asOf;
    // Date.parse would coerce a number or Date into some old instant, so only a string timestamp counts.
    const observedBy = (observedAt: unknown, asOf: string) =>
        typeof observedAt === "string" && instant(observedAt) <= instant(asOf);
    return {
        findSlots(query) {
            const asOf = clamp(query.asOf);
            // Fail closed, one candidate at a time: detach the reference once, then keep exactly that copy only
            // if the slot's own snapshot names it and proves it was observed by asOf. Anything malformed or
            // unprovable is dropped rather than trusted. Age is irrelevant here, so freshness is not limited.
            return map.findSlots({ ...query, asOf }).flatMap(candidate => {
                try {
                    const { locationId, slotId } = structuredClone(candidate) as SlotReference;
                    if (typeof locationId !== "string" || typeof slotId !== "string") return [];
                    const snapshot = structuredClone(map.readSlot({ locationId, slotId }, asOf, Number.MAX_SAFE_INTEGER)) as SlotSnapshot | null;
                    const names = snapshot?.slot?.id === slotId && snapshot.slot.locationId === locationId;
                    return names && snapshot.status !== "unavailable" && observedBy(snapshot.observedAt, asOf) ? [{ locationId, slotId }] : [];
                } catch {
                    return [];
                }
            });
        },
        readSlot(reference, asOf, maximumAgeMinutes) {
            const at = clamp(asOf);
            const snapshot = map.readSlot(reference, at, maximumAgeMinutes);
            if (snapshot.status !== "unavailable" && observedBy(snapshot.observedAt, at)) return structuredClone(snapshot);
            return { status: "unavailable", source: snapshot.source, projected: false, simulated: snapshot.simulated };
        },
        readForecast(reference, asOf) {
            const at = clamp(asOf);
            const forecast = map.readForecast(reference, at);
            const visible: SlotForecast = {};
            for (const metric of ["carbon", "demand", "solar"] as const) {
                const series = forecast[metric];
                if (series && observedBy(series.issuedAt ?? series.retrievedAt, at)) visible[metric] = structuredClone(series);
            }
            return visible;
        },
    };
}
