import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import type { SlotForecast } from "../../energy/SlotForecast.type.js";

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
    const observedBy = (observedAt: string | undefined, asOf: string) =>
        observedAt !== undefined && instant(observedAt) <= instant(asOf);
    return {
        findSlots(query) {
            const asOf = clamp(query.asOf);
            // Discovery may include undated slots (readSlot withholds them), but never one observed later.
            return map.findSlots({ ...query, asOf }).filter(reference => {
                const { observedAt } = map.readSlot(reference, asOf, Number.MAX_SAFE_INTEGER);
                return observedAt === undefined || observedBy(observedAt, asOf);
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
