import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import type { SlotForecast } from "../../energy/SlotForecast.type.js";

function instant(value: string): number {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new RangeError(`Invalid timestamp: ${value}`);
    return time;
}

/**
 * Planning view of a map as of `fence` (the tick start). Reads are clamped to the fence and any
 * evidence stamped after it is withheld, using each item's own observedAt / issuedAt rather than
 * its window: regional actuals are hour-ending, but a site slot observed exactly at the fence is
 * already known. Undated slot evidence cannot prove it is not from the future, so it is withheld.
 */
export function fenceEnergyMap(map: EnergyMap, fence: string): EnergyMap {
    const limit = instant(fence);
    const clamp = (asOf: string) => instant(asOf) > limit ? fence : asOf;
    return {
        findSlots(query) {
            return map.findSlots({ ...query, asOf: clamp(query.asOf) });
        },
        readSlot(reference, asOf, maximumAgeMinutes) {
            const snapshot = map.readSlot(reference, clamp(asOf), maximumAgeMinutes);
            if (snapshot.status === "unavailable" || (snapshot.observedAt !== undefined && instant(snapshot.observedAt) <= limit))
                return snapshot;
            return { status: "unavailable", source: snapshot.source, projected: false, simulated: snapshot.simulated };
        },
        readForecast(reference, asOf) {
            const forecast = map.readForecast(reference, clamp(asOf));
            const visible: SlotForecast = {};
            for (const metric of ["carbon", "demand", "solar"] as const) {
                const series = forecast[metric];
                if (series && instant(series.issuedAt ?? series.retrievedAt) <= limit) visible[metric] = series;
            }
            return visible;
        },
    };
}
