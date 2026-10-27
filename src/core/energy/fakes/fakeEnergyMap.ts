import { getEnergyMap } from "../getEnergyMap.js";
import type { SlotQuery } from "../SlotQuery.interface.js";
import snapshots from "./snapshots.json";
import forecastArtifact from "./forecasts.json";
import type { EnergyMap } from "../EnergyMap.interface.js";
import type { SlotSnapshot } from "../SlotSnapshot.type.js";
import type { SlotForecast } from "../SlotForecast.type.js";
import type { SlotReference } from "../SlotReference.type.js";

const forecasts = forecastArtifact.forecasts as Record<string, SlotForecast>;
const find = (reference: SlotReference) => snapshots.sites.find(site =>
    site.id === reference.locationId && site.snapshot.slot.id === reference.slotId);

function instant(value: string) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new RangeError(`Invalid timestamp: ${value}`);
    return time;
}

/** JSON-backed Fake of the existing active-map contract; all reads return fresh data. */
export const fakeEnergyMap: EnergyMap = {
    findSlots(query) {
        const start = instant(query.window.startAt), end = instant(query.window.endAt);
        const asOf = instant(query.asOf);
        if (end <= start) throw new RangeError("The query window must have positive duration.");
        return snapshots.sites.filter(site =>
            (!query.locations || query.locations.includes(site.id)) &&
            (!query.computeProfile || query.computeProfile === site.computeProfile) &&
            instant(site.snapshot.observedAt) <= asOf &&
            instant(site.snapshot.slot.window.startAt) < end &&
            instant(site.snapshot.slot.window.endAt) > start
        ).map(site => ({ locationId: site.id, slotId: site.snapshot.slot.id }));
    },
    readSlot(reference, asOf, maximumAgeMinutes) {
        const at = instant(asOf);
        if (!Number.isFinite(maximumAgeMinutes) || maximumAgeMinutes < 0)
            throw new RangeError("maximumAgeMinutes must be finite and nonnegative.");
        const site = find(reference);
        if (!site || instant(site.snapshot.observedAt) > at)
            return { status: "unavailable", source: "fake-local-energy", projected: false, simulated: true };
        const snapshot = structuredClone(site.snapshot) as SlotSnapshot;
        snapshot.status = at - instant(site.snapshot.observedAt) > maximumAgeMinutes * 60_000 ? "stale" : "current";
        snapshot.location = { name: site.name, latitude: site.latitude, longitude: site.longitude, regionId: site.regionId };
        return snapshot;
    },
    readForecast(reference, asOf) {
        const at = instant(asOf), site = find(reference);
        const result: SlotForecast = {};
        if (!site) return result;
        for (const metric of ["carbon", "demand", "solar"] as const) {
            const series = forecasts[site.regionId]?.[metric];
            if (series && instant(series.issuedAt ?? series.retrievedAt) <= at)
                result[metric] = structuredClone(series);
        }
        return result;
    },
};

/** Preview wrapper choosing the Fake active-map source. */
export function getFakeEnergyMap(query: SlotQuery) {
    return getEnergyMap(query, fakeEnergyMap);
}
