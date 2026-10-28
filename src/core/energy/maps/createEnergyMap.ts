import type { EnergyMap } from "../EnergyMap.interface.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SlotSnapshot } from "../SlotSnapshot.type.js";
import type { SlotForecast } from "../SlotForecast.type.js";
import type { SlotQuery } from "../SlotQuery.interface.js";
import type { SlotReference } from "../SlotReference.type.js";
import type { EnergyMapScope, EnergyMapProviders } from "./EnergyMap.types.js";

/**
 * Read-only EnergyMap over the existing site and regional providers.
 * The catalog and horizon are captured at construction; provider data is read afresh.
 * Reads need no prior findSlots call. History is limited to versions the provider returns.
 * Observation times order opaque versions; tied latest records are unavailable.
 * Regional forecast timestamps remain independent of local availability freshness.
 * Forecast lookup requires an identifiable local slot window, even when capacity is unavailable.
 * Provider errors propagate to the caller rather than becoming fabricated capacity.
 */
export function createEnergyMap(scope: EnergyMapScope, providers: EnergyMapProviders): EnergyMap {
    const { siteEnergy, regionalGrid } = providers;
    const horizon = { ...scope.window };
    const [horizonStart, horizonEnd] = period(horizon);
    const sites = scope.sites.map(site => ({ ...site }));
    if (sites.some(site => !site.locationId || !site.regionId || !site.computeProfile) ||
        new Set(sites.map(site => site.locationId)).size !== sites.length)
        throw new RangeError("Sites require a region and compute profile for each unique location ID.");

    const snapshots = (locationId: string): SlotSnapshot[] => siteEnergy.slots(locationId, { ...horizon });
    const resolve = (reference: SlotReference, at: number): SlotSnapshot | undefined => {
        if (!sites.some(site => site.locationId === reference.locationId)) return undefined;
        return latest(snapshots(reference.locationId).filter(value => value.slot?.id === reference.slotId), at);
    };
    const withinHorizon = (snapshot: SlotSnapshot | undefined, locationId: string): boolean => {
        const slot = snapshot?.slot;
        return slot !== undefined && slot.locationId === locationId &&
            Date.parse(slot.window.startAt) < Date.parse(slot.window.endAt) &&
            Date.parse(slot.window.startAt) < horizonEnd && Date.parse(slot.window.endAt) > horizonStart;
    };

    return {
        /** Find candidates in the requested window using evidence known by query.asOf. */
        findSlots(query: SlotQuery): SlotReference[] {
            const [start, end] = period(query.window);
            const at = instant(query.asOf);
            if (start >= horizonEnd || end <= horizonStart) return [];
            return sites.filter(site => (!query.locations || query.locations.includes(site.locationId)) &&
                (!query.computeProfile || query.computeProfile === site.computeProfile))
                .flatMap(site => {
                    const values = snapshots(site.locationId);
                    return [...new Set(values.map(value => value.slot?.id).filter(id => id))].flatMap(slotId => {
                        const value = latest(values.filter(value => value.slot?.id === slotId), at);
                        const slot = value?.slot;
                        return withinHorizon(value, site.locationId) && slot &&
                            Date.parse(slot.window.startAt) < end && Date.parse(slot.window.endAt) > start
                            ? [{ locationId: site.locationId, slotId: slot.id }] : [];
                    });
                });
        },
        readSlot(reference: SlotReference, asOf: string, maximumAgeMinutes: number): SlotSnapshot {
            const at = instant(asOf);
            if (!Number.isFinite(maximumAgeMinutes) || maximumAgeMinutes < 0)
                throw new RangeError("maximumAgeMinutes must be finite and nonnegative.");
            const value = resolve(reference, at);
            if (!withinHorizon(value, reference.locationId) || !value || !valid(value)) return unavailable(value);
            const snapshot = structuredClone(value);
            if (snapshot.status === "current" &&
                (at - Date.parse(snapshot.observedAt!)) / 60_000 > maximumAgeMinutes) snapshot.status = "stale";
            return snapshot;
        },
        readForecast(reference: SlotReference, asOf: string): SlotForecast {
            const at = instant(asOf);
            const site = sites.find(site => site.locationId === reference.locationId);
            const snapshot = resolve(reference, at);
            if (!site || !withinHorizon(snapshot, reference.locationId)) return {};
            const supplied = regionalGrid.read(site.regionId, { ...snapshot!.slot!.window }).forecast;
            const result: SlotForecast = {};
            for (const metric of ["carbon", "demand", "solar"] as const) {
                const series = supplied[metric];
                if (series && Date.parse(series.retrievedAt) <= at &&
                    Date.parse(series.issuedAt ?? series.retrievedAt) <= at)
                    result[metric] = structuredClone(series);
            }
            return result;
        },
    };
}

function instant(value: string): number {
    const at = Date.parse(value);
    if (!Number.isFinite(at)) throw new RangeError(`Invalid timestamp: ${value}`);
    return at;
}

function period(window: TimeWindow): readonly [number, number] {
    const start = instant(window.startAt), end = instant(window.endAt);
    if (start >= end) throw new RangeError("The window must have positive duration.");
    return [start, end] as const;
}

function latest(values: SlotSnapshot[], at: number): SlotSnapshot | undefined {
    // Unorderable evidence cannot safely fall back to a potentially superseded version.
    if (values.some(value => !Number.isFinite(Date.parse(value.observedAt ?? "")))) return undefined;
    const known = values.filter(value => Date.parse(value.observedAt!) <= at);
    const newest = Math.max(...known.map(value => Date.parse(value.observedAt!)));
    const matches = known.filter(value => Date.parse(value.observedAt!) === newest);
    return matches.length === 1 ? matches[0] : undefined;
}

function valid(snapshot: SlotSnapshot): boolean {
    const slot = snapshot.slot!;
    return (snapshot.status === "current" || snapshot.status === "stale") &&
        Boolean(snapshot.source && snapshot.version && slot.id && slot.priceBasis) &&
        [slot.availablePowerKW, slot.availableEnergyKWh, slot.capGpus, slot.usedGpus, slot.postedUsdPerGpuHour]
            .every(value => Number.isFinite(value) && value >= 0) &&
        Number.isInteger(slot.capGpus) && Number.isInteger(slot.usedGpus) && slot.usedGpus <= slot.capGpus;
}

function unavailable(snapshot?: SlotSnapshot): SlotSnapshot {
    return {
        ...(snapshot ? structuredClone(snapshot) : { source: "energy-map", projected: false, simulated: true }),
        status: "unavailable", slot: undefined, siteEnergy: undefined,
    };
}
