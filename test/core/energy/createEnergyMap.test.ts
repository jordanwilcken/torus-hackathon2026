import { describe, expect, it } from "vitest";
import { createEnergyMap } from "../../../src/core/energy/map/createEnergyMap.js";
import { getEnergyMap } from "../../../src/core/energy/getEnergyMap.js";
import type { SlotSnapshot } from "../../../src/core/energy/SlotSnapshot.type.js";
import type { SlotForecast } from "../../../src/core/energy/SlotForecast.type.js";

const window = { startAt: "2026-10-27T12:00:00Z", endAt: "2026-10-27T13:00:00Z" };
const asOf = "2026-10-27T12:06:00Z";
const reference = { locationId: "A", slotId: "A-noon" };

function expectUnavailable(snapshot: SlotSnapshot) {
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.slot).toBeUndefined();
    expect(snapshot.siteEnergy).toBeUndefined();
}

function reading(locationId = "A", observedAt = "2026-10-27T12:05:00Z"): SlotSnapshot {
    return {
        status: "current", source: `local-${locationId}`, version: "revision-1", observedAt,
        projected: false, simulated: true,
        location: { name: `Site ${locationId}`, latitude: 40, longitude: -111, regionId: "PACE" },
        siteEnergy: { storedKWh: 4, protectedKWh: 2 },
        slot: {
            id: `${locationId}-noon`, locationId, window: { ...window },
            availablePowerKW: 2, availableEnergyKWh: 2, capGpus: 2, usedGpus: 0,
            postedUsdPerGpuHour: .08, priceBasis: "supplied modeled energy and carbon",
        },
    };
}

function forecast(): SlotForecast {
    return {
        carbon: {
            source: "regional-carbon-model", scope: "PACE", basis: "generation lifecycle proxy",
            unit: "gCO2e/kWh", issuedAt: "2026-10-27T11:00:00Z", retrievedAt: "2026-10-27T11:02:00Z",
            simulated: true, points: [{ window: { ...window }, value: 200 }],
        },
        solar: {
            source: "site-solar-model", scope: "A", basis: "simulated local solar", unit: "kW",
            issuedAt: "2026-10-27T12:05:00Z", retrievedAt: "2026-10-27T12:05:00Z",
            simulated: true, points: [{ window: { ...window }, value: 2 }],
        },
    };
}

function scenario(readings: Record<string, SlotSnapshot[]> = { A: [reading()] }, forecasts: SlotForecast = {}) {
    const sites = [
        { locationId: "A", regionId: "PACE", computeProfile: "H100" },
        { locationId: "B", regionId: "PACE", computeProfile: "L4" },
    ];
    const options = {
        window: { ...window }, sites,
        siteEnergy: { slots: (locationId: string) => readings[locationId] ?? [] },
        regionalGrid: { read: () => ({ observations: [], forecast: forecasts }) },
    };
    return { map: createEnergyMap(options), options, readings, forecasts };
}

describe("versioned energy lookup over supplied providers", () => {
    it("keeps 12:00 stale and 12:05 current at 12:06 with a five-minute limit", () => {
        const { map } = scenario({ A: [reading("A", "2026-10-27T12:00:00Z")], B: [reading("B")] });
        const view = getEnergyMap({ window, asOf }, map, 5);
        expect(view.sites.get("A")!.slots[0].snapshot.status).toBe("stale");
        expect(view.sites.get("A")!.slots[0].availableNow).toBe(false);
        expect(view.sites.get("B")!.slots[0].snapshot.status).toBe("current");
        expect(view.sites.get("B")!.slots[0].availableNow).toBe(true);
    });

    it("reads a self-contained version directly without first discovering slots", () => {
        const supplied = reading();
        expect(scenario({ A: [supplied] }).map.readSlot(reference, asOf, 5)).toEqual(supplied);
    });

    it("includes the exact freshness boundary and never promotes a provider's stale status", () => {
        const supplied = reading("A", "2026-10-27T12:01:00Z");
        const { map } = scenario({ A: [supplied] });
        expect(map.readSlot(reference, asOf, 5).status).toBe("current");
        supplied.status = "stale";
        expect(map.readSlot(reference, asOf, 5).status).toBe("stale");
    });

    it("discovers overlapping slots by location and profile without clipping their quantities", () => {
        const { map } = scenario({ A: [reading()], B: [reading("B")] });
        const query = { window: { startAt: "2026-10-27T12:30:00Z", endAt: window.endAt }, asOf, computeProfile: "H100" };
        expect(map.findSlots(query)).toEqual([reference]);
        expect(map.findSlots({ ...query, locations: ["B"] })).toEqual([]);
        expect(map.findSlots({ window: { startAt: window.endAt, endAt: "2026-10-27T14:00:00Z" }, asOf })).toEqual([]);
        expect(map.readSlot(reference, asOf, 5).slot).toMatchObject({ window, availableEnergyKWh: 2 });
    });

    it("retains distinct same-site slot identities and conditional future evidence", () => {
        const current = reading(), future = reading();
        future.slot = { ...future.slot!, id: "A-next-hour", window: { startAt: window.endAt, endAt: "2026-10-27T14:00:00Z" } };
        future.projected = true;
        const { options } = scenario({ A: [current, future] });
        options.window.endAt = "2026-10-27T14:00:00Z";
        const map = createEnergyMap(options);
        expect(map.findSlots({ window: options.window, asOf })).toEqual([reference, { locationId: "A", slotId: "A-next-hour" }]);
        expect(map.readSlot({ locationId: "A", slotId: "A-next-hour" }, asOf, 5)).toEqual(future);
    });

    it("selects the latest observed version rather than sorting opaque version names", () => {
        const older = reading("A", "2026-10-27T12:00:00Z"), newer = reading();
        older.version = "z";
        newer.version = "a";
        const { map, readings } = scenario({ A: [newer, older] });
        expect(map.findSlots({ window, asOf })).toEqual([reference]);
        expect(map.readSlot(reference, asOf, 5).version).toBe("a");
        const next = reading("A", "2026-10-27T12:06:00Z");
        next.version = "next";
        next.slot!.usedGpus = 1;
        readings.A.push(next);
        expect(map.readSlot(reference, asOf, 5)).toEqual(next);
    });

    it("does not expose future observations and can read an earlier supplied version", () => {
        const future = reading("A", "2026-10-27T12:07:00Z"), current = reading();
        const { map } = scenario({ A: [future, current] });
        expect(map.readSlot(reference, asOf, 5)).toEqual(current);
        const onlyFuture = scenario({ A: [future] }).map;
        expect(onlyFuture.findSlots({ window, asOf })).toEqual([]);
        expectUnavailable(onlyFuture.readSlot(reference, asOf, 5));
    });

    it("keeps unknown references and missing local evidence unavailable", () => {
        const { map } = scenario({});
        expect(map.findSlots({ window, asOf })).toEqual([]);
        expectUnavailable(map.readSlot(reference, asOf, 5));
        expectUnavailable(map.readSlot({ ...reference, locationId: "unknown" }, asOf, 5));
        expect(map.readForecast(reference, asOf)).toEqual({});
    });

    it("does not revive older capacity when the newest revision is unavailable or invalid", () => {
        const older = reading("A", "2026-10-27T12:00:00Z"), newer = reading();
        newer.status = "unavailable";
        const { map } = scenario({ A: [older, newer] });
        expectUnavailable(map.readSlot(reference, asOf, 5));
        expect(map.readSlot(reference, asOf, 5).source).toBe("local-A");
        newer.status = "current";
        newer.slot!.availableEnergyKWh = NaN;
        expectUnavailable(map.readSlot(reference, asOf, 5));
        newer.observedAt = "invalid";
        expectUnavailable(map.readSlot(reference, asOf, 5));
    });

    it("rejects conflicting versions with the same observation timestamp", () => {
        const first = reading(), second = reading();
        second.version = "conflicting";
        expectUnavailable(scenario({ A: [first, second] }).map.readSlot(reference, asOf, 5));
    });

    it("never returns malformed capacity or missing provenance as current", () => {
        const changes: ((snapshot: SlotSnapshot) => void)[] = [
            value => { value.version = undefined; },
            value => { value.observedAt = undefined; },
            value => { value.observedAt = "invalid"; },
            value => { value.source = ""; },
            value => { value.slot!.availablePowerKW = -1; },
            value => { value.slot!.availableEnergyKWh = Infinity; },
            value => { value.slot!.capGpus = 1.5; },
            value => { value.slot!.usedGpus = 3; },
            value => { value.slot!.postedUsdPerGpuHour = -1; },
            value => { value.slot!.window.endAt = window.startAt; },
            value => { value.slot!.locationId = "B"; },
        ];
        for (const change of changes) {
            const supplied = reading();
            change(supplied);
            expect(scenario({ A: [supplied] }).map.readSlot(reference, asOf, 5).status).toBe("unavailable");
        }
    });

    it("keeps regional forecasts available independently of stale local readings", () => {
        const supplied = forecast();
        const { map } = scenario({ A: [reading("A", "2026-10-27T12:00:00Z")] }, supplied);
        expect(map.readSlot(reference, asOf, 5).status).toBe("stale");
        expect(map.readForecast(reference, asOf)).toEqual(supplied);
        expect(map.readForecast(reference, asOf).carbon).toMatchObject({ source: "regional-carbon-model", issuedAt: "2026-10-27T11:00:00Z", retrievedAt: "2026-10-27T11:02:00Z" });
    });

    it("omits future-issued and future-retrieved metrics separately", () => {
        const supplied = forecast();
        supplied.carbon!.retrievedAt = "2026-10-27T12:07:00Z";
        const { map } = scenario(undefined, supplied);
        expect(map.readForecast(reference, asOf)).toEqual({ solar: supplied.solar });
        supplied.carbon!.retrievedAt = "2026-10-27T12:05:00Z";
        supplied.solar!.issuedAt = "2026-10-27T12:07:00Z";
        expect(map.readForecast(reference, asOf)).toEqual({ carbon: supplied.carbon });
    });

    it("uses the configured region and original slot period for forecast lookup", () => {
        const { options } = scenario();
        const supplied = forecast();
        options.regionalGrid.read = (...args: unknown[]) => {
            expect(args).toEqual(["PACE", window]);
            return { observations: [], forecast: supplied };
        };
        expect(createEnergyMap(options).readForecast(reference, asOf)).toEqual(supplied);
    });

    it("returns detached snapshots and forecasts without changing provider data or configuration", () => {
        const { map, readings, forecasts, options } = scenario(undefined, forecast());
        const before = structuredClone({ readings, forecasts, window: options.window, sites: options.sites });
        map.findSlots({ window, asOf });
        const snapshot = map.readSlot(reference, asOf, 5);
        snapshot.slot!.usedGpus = 2;
        snapshot.siteEnergy!.storedKWh = 0;
        const result = map.readForecast(reference, asOf);
        result.carbon!.points[0].value = 999;
        expect({ readings, forecasts, window: options.window, sites: options.sites }).toEqual(before);
        expect(map.readSlot(reference, asOf, 5).slot!.usedGpus).toBe(0);
        expect(map.readForecast(reference, asOf).carbon!.points[0].value).toBe(200);
    });

    it("captures its catalog and horizon while continuing to read provider updates", () => {
        const { map, options, readings } = scenario();
        options.sites[0].locationId = "changed";
        options.window.endAt = options.window.startAt;
        readings.A[0].slot!.usedGpus = 1;
        expect(map.findSlots({ window, asOf })).toEqual([reference]);
        expect(map.readSlot(reference, asOf, 5).slot!.usedGpus).toBe(1);
    });

    it("rejects invalid caller times, freshness limits and ambiguous configuration", () => {
        const { map, options } = scenario();
        expect(() => map.readSlot(reference, "invalid", 5)).toThrow(RangeError);
        expect(() => map.readSlot(reference, asOf, -1)).toThrow(RangeError);
        expect(() => map.readSlot(reference, asOf, Infinity)).toThrow(RangeError);
        expect(() => map.readForecast(reference, "invalid")).toThrow(RangeError);
        expect(() => map.findSlots({ window: { startAt: asOf, endAt: asOf }, asOf })).toThrow(RangeError);
        expect(() => createEnergyMap({ ...options, sites: [...options.sites, options.sites[0]] })).toThrow(RangeError);
        expect(() => createEnergyMap({ ...options, window: { startAt: asOf, endAt: asOf } })).toThrow(RangeError);
    });
});
