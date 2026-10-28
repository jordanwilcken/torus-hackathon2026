import { describe, expect, it } from "vitest";
import { createSiteEnergyLedger } from "../../../../src/core/energy/site/createSiteEnergyLedger.js";
import { createEnergyMap } from "../../../../src/core/energy/maps/createEnergyMap.js";
import type { SiteEnergyConfiguration, SiteEnergyInput, SiteEnergyLoad, SiteEnergyQuoteProvider } from "../../../../src/core/energy/site/SiteEnergy.types.js";
import type { TimeWindow } from "../../../../src/core/TimeWindow.type.js";

const firstHour: TimeWindow = { startAt: "2026-10-28T12:00:00Z", endAt: "2026-10-28T13:00:00Z" };
const secondHour: TimeWindow = { startAt: firstHour.endAt, endAt: "2026-10-28T14:00:00Z" };

function configuration(): SiteEnergyConfiguration {
    return {
        locationId: "site-A", compute: { capGpus: 8, kWPerGpu: 1 },
        storage: {
            initial: { storedKWh: 0, carbonKg: 0, electricityUsd: 0 },
            limits: { capacityKWh: 10, chargeKW: 10, dischargeKW: 10 },
            efficiency: { charge: 1, discharge: 1 },
        },
        accountingBasis: "Supplied simulation; operational consumption accounting with carried storage burdens",
    };
}

function input(window: TimeWindow = firstHour): SiteEnergyInput {
    return {
        window: { ...window },
        supply: { solarKW: 0, fixedLoadKW: 0, gridImportLimitKW: 0, protectedKWh: 0 },
        evidence: { source: "supplied-local-reading", version: "reading-1", observedAt: window.startAt, status: "current", projected: false },
        accounting: { solarCarbonGPerKWh: 0, gridCarbonGPerKWh: 400, solarUsdPerMWh: 0, gridUsdPerMWh: 100 },
    };
}

function load(id: string, gpus: number, window: TimeWindow = firstHour): SiteEnergyLoad {
    return { id, gpus, window: { ...window } };
}

const quote: SiteEnergyQuoteProvider = offer => ({ version: offer.version, usdPerGpuHour: .1, basis: "Supplied posted quote" });

describe("local site-energy ledger", () => {
    it("keeps all 4 stored kWh protected and rejects discretionary compute", () => {
        const config = configuration(), reading = input();
        config.storage.initial.storedKWh = 4;
        reading.supply!.protectedKWh = 4;
        const ledger = createSiteEnergyLedger(config, [reading], quote);
        expect(ledger.slots("site-A", firstHour)[0].slot?.availableEnergyKWh).toBe(0);
        expect(ledger.reserve({ version: ledger.state().version, load: load("a", 1) }).accepted).toBe(false);
        expect(ledger.state().inventory.storedKWh).toBe(4);
    });

    it("reserves energy atomically, replays a retry and rejects double spending", () => {
        const config = configuration(), reading = input();
        config.storage.initial.storedKWh = 6;
        reading.supply!.protectedKWh = 2;
        const ledger = createSiteEnergyLedger(config, [reading], quote);
        const request = { version: ledger.state().version, load: load("a", 3) };
        const accepted = ledger.reserve(request);
        expect(accepted.accepted).toBe(true);
        expect(ledger.reserve(request)).toEqual(accepted);
        expect(ledger.reserve({ version: ledger.state().version, load: load("b", 2) }).accepted).toBe(false);
        expect(ledger.state().inventory.storedKWh).toBe(6);
        expect(ledger.reserve({ version: ledger.state().version, load: load("b", 1) }).accepted).toBe(true);
        const result = ledger.dispatch({ window: firstHour, loads: [load("a", 3), load("b", 1)] });
        expect(result.feasible).toBe(true);
        expect(result.meters[0]).toMatchObject({ computeKWh: 4, batteryDischargeKWh: 4, endingStoredKWh: 2 });
        expect(ledger.state().inventory.storedKWh).toBe(2);
    });

    it("projects consecutive hours from one copied inventory rather than reusing initial storage", () => {
        const config = configuration(), first = input(), second = input(secondHour);
        config.storage.initial.storedKWh = 5;
        first.supply!.protectedKWh = second.supply!.protectedKWh = 1;
        const ledger = createSiteEnergyLedger(config, [first, second], quote);
        const result = ledger.assess([load("a", 3), load("b", 1, secondHour)]);
        expect(result.feasible).toBe(true);
        expect(result.meters.map(meter => meter.endingStoredKWh)).toEqual([2, 1]);
        expect(ledger.state().inventory.storedKWh).toBe(5);
        const published = ledger.slots("site-A", { startAt: firstHour.startAt, endAt: secondHour.endAt });
        expect(published.map(snapshot => snapshot.slot!.availableEnergyKWh)).toEqual([4, 0]);
        expect(published[1].projected).toBe(true);
    });

    it("accounts for charge and discharge losses and makes exact settlement retries idempotent", () => {
        const config = configuration(), first = input(), second = input(secondHour);
        config.storage.initial.storedKWh = 2;
        config.storage.efficiency = { charge: .8, discharge: .75 };
        first.supply = { solarKW: 6, fixedLoadKW: 1, gridImportLimitKW: 0, protectedKWh: 2 };
        second.supply!.protectedKWh = 2;
        const ledger = createSiteEnergyLedger(config, [first, second]);
        expect(ledger.reserve({ version: ledger.state().version, load: load("a", 1) }).accepted).toBe(true);
        const charge = ledger.dispatch({ window: firstHour, loads: [load("a", 1)] });
        expect(charge.feasible).toBe(true);
        expect(charge.meters[0]).toMatchObject({ solarKWh: 6, fixedLoadKWh: 1, computeKWh: 1, batteryChargeKWh: 4 });
        expect(charge.inventory.storedKWh).toBeCloseTo(5.2);
        const partial = load("b", 3, { startAt: secondHour.startAt, endAt: "2026-10-28T13:48:00Z" });
        expect(ledger.reserve({ version: ledger.state().version, load: partial }).accepted).toBe(true);
        const tick = { window: secondHour, loads: [partial] };
        const result = ledger.dispatch(tick);
        expect(result.feasible).toBe(true);
        expect(result.meters[0].computeKWh).toBeCloseTo(2.4);
        expect(result.inventory.storedKWh).toBeCloseTo(2);
        expect(ledger.dispatch(tick)).toEqual(result);
        expect(ledger.state().inventory.storedKWh).toBeCloseTo(2);
    });

    it("keeps partial-job active power instead of averaging it over the hour", () => {
        const config = configuration(), reading = input();
        config.compute.kWPerGpu = 2;
        reading.supply = { solarKW: 0, fixedLoadKW: .5, gridImportLimitKW: 2, protectedKWh: 0 };
        const partial = load("partial", 1, { startAt: firstHour.startAt, endAt: "2026-10-28T12:15:00Z" });
        const limited = createSiteEnergyLedger(config, [reading]);
        expect(limited.reserve({ version: limited.state().version, load: partial }).accepted).toBe(false);
        reading.supply.gridImportLimitKW = 2.5;
        const sufficient = createSiteEnergyLedger(config, [reading]);
        expect(sufficient.reserve({ version: sufficient.state().version, load: partial }).accepted).toBe(true);
        expect(sufficient.dispatch({ window: firstHour, loads: [partial] }).meters[0]).toMatchObject({ computeKWh: .5, fixedLoadKWh: .5, gridImportKWh: 1 });
    });

    it("meters idle fixed load once and rejects changed retries or out-of-order ticks", () => {
        const first = input(), second = input(secondHour);
        first.supply!.fixedLoadKW = second.supply!.fixedLoadKW = 1;
        first.supply!.gridImportLimitKW = second.supply!.gridImportLimitKW = 2;
        const ledger = createSiteEnergyLedger(configuration(), [first, second]);
        expect(ledger.dispatch({ window: secondHour, loads: [] }).feasible).toBe(false);
        const tick = { window: firstHour, loads: [] };
        const result = ledger.dispatch(tick);
        expect(result.feasible).toBe(true);
        expect(result.meters[0]).toMatchObject({ gridImportKWh: 1, fixedLoadKWh: 1, computeKWh: 0 });
        expect(ledger.dispatch(tick)).toEqual(result);
        expect(ledger.dispatch({ window: firstHour, loads: [load("unreserved", 1)] }).feasible).toBe(false);
        expect(ledger.dispatch({ window: secondHour, loads: [] }).meters[0].gridImportKWh).toBe(1);
    });
});

describe("ledger failure and accounting boundaries", () => {
    it("refreshes quote publication explicitly without changing physical input or inventory", () => {
        const reading = input();
        reading.supply!.gridImportLimitKW = 2;
        let rate = .1;
        const supplied: SiteEnergyQuoteProvider = offer => ({ version: offer.version, usdPerGpuHour: rate, basis: "Supplied policy" });
        const ledger = createSiteEnergyLedger(configuration(), [reading], supplied);
        const first = ledger.slots("site-A", firstHour)[0];
        rate = .2;
        expect(ledger.slots("site-A", firstHour)[0].slot!.postedUsdPerGpuHour).toBe(.1);
        const before = ledger.state().inventory;
        ledger.refreshPublication();
        const updated = ledger.slots("site-A", firstHour)[0];
        expect(updated.version).not.toBe(first.version);
        expect(updated.slot!.postedUsdPerGpuHour).toBe(.2);
        expect(ledger.reserve({ version: first.version!, load: load("a", 1) }).accepted).toBe(false);
        expect(ledger.state().inventory).toEqual(before);
    });

    it("feeds the existing EnergyMap with refreshed physical capacity and retained source evidence", () => {
        const config = configuration(), reading = input();
        config.storage.initial.storedKWh = 4;
        const ledger = createSiteEnergyLedger(config, [reading], quote);
        const map = createEnergyMap({ window: firstHour, sites: [{ locationId: "site-A", regionId: "PACE", computeProfile: "H100" }] }, {
            siteEnergy: ledger, regionalGrid: { read: () => ({ observations: [], forecast: {} }) },
        });
        const reference = map.findSlots({ window: firstHour, asOf: firstHour.startAt })[0];
        const before = map.readSlot(reference, firstHour.startAt, 5);
        expect(before).toMatchObject({ status: "current", source: "supplied-local-reading", simulated: true, projected: false });
        expect(before.slot!.availableEnergyKWh).toBe(4);
        expect(ledger.reserve({ version: before.version!, load: load("a", 3) }).accepted).toBe(true);
        const after = map.readSlot(reference, firstHour.startAt, 5);
        expect(after.version).not.toBe(before.version);
        expect(after.slot).toMatchObject({ usedGpus: 3, availableEnergyKWh: 1 });
        expect(before.slot!.usedGpus).toBe(0);
        expect(ledger.dispatch({ window: firstHour, loads: [load("a", 3)] }).inventory.storedKWh).toBe(1);
        expect(map.readSlot(reference, firstHour.endAt, 5).status).toBe("unavailable");
    });

    it("conserves energy and accounts the literal solar, battery and grid mixture", () => {
        const config = configuration(), reading = input();
        config.storage.initial = { storedKWh: 3, carbonKg: .3, electricityUsd: .06 };
        config.storage.efficiency.discharge = .75;
        reading.supply = { solarKW: 1, fixedLoadKW: .5, gridImportLimitKW: 3, protectedKWh: 0 };
        const result = createSiteEnergyLedger(config, [reading]).assess([load("a", 3)]);
        expect(result.feasible).toBe(true);
        const meter = result.meters[0];
        expect(meter).toMatchObject({ solarKWh: 1, gridImportKWh: .25, batteryDischargeKWh: 2.25, fixedLoadKWh: .5, computeKWh: 3, endingStoredKWh: 0 });
        expect(meter.carbonKg).toBeCloseTo(.4);
        expect(meter.electricityUsd).toBeCloseTo(.085);
        expect(meter.solarKWh + meter.gridImportKWh + meter.batteryDischargeKWh)
            .toBe(meter.fixedLoadKWh + meter.computeKWh + meter.batteryChargeKWh + meter.curtailedKWh);
        expect(3 + meter.batteryChargeKWh - meter.batteryDischargeKWh / .75).toBe(meter.endingStoredKWh);
    });

    it("rejects invalid configuration, noncanonical ticks, changed-version reuse and projected dispatch", () => {
        const config = configuration(), reading = input();
        config.storage.efficiency.discharge = 0;
        expect(() => createSiteEnergyLedger(config, [reading])).toThrow(RangeError);
        const gap = input({ startAt: "2026-10-28T14:00:00Z", endAt: "2026-10-28T15:00:00Z" });
        expect(() => createSiteEnergyLedger(configuration(), [reading, gap])).toThrow(RangeError);
        reading.evidence.projected = true;
        const ledger = createSiteEnergyLedger(configuration(), [reading]);
        const before = ledger.state();
        expect(ledger.dispatch({ window: firstHour, loads: [] }).feasible).toBe(false);
        expect(ledger.dispatch({ window: { startAt: firstHour.startAt, endAt: "2026-10-28T12:30:00Z" }, loads: [] }).feasible).toBe(false);
        expect(ledger.assess([load("bad", 0)]).feasible).toBe(false);
        const changed = structuredClone(reading);
        changed.supply!.solarKW = 1;
        expect(() => ledger.update(changed)).toThrow(RangeError);
        expect(ledger.state()).toEqual(before);
        expect(ledger.slots("unknown-site", firstHour)).toEqual([]);
    });

    it("settles known current fixed load even when a later reading is unavailable", () => {
        const first = input(), missing = input(secondHour);
        first.supply!.gridImportLimitKW = 2;
        first.supply!.fixedLoadKW = 1;
        missing.supply = undefined;
        const ledger = createSiteEnergyLedger(configuration(), [first, missing], quote);
        expect(ledger.assess([]).feasible).toBe(false);
        expect(ledger.slots("site-A", firstHour)[0].status).toBe("current");
        expect(ledger.reserve({ version: ledger.state().version, load: load("a", 1) }).accepted).toBe(true);
        expect(ledger.dispatch({ window: firstHour, loads: [] }).meters[0]).toMatchObject({ fixedLoadKWh: 1, gridImportKWh: 1 });
        expect(ledger.state().nextWindow).toEqual(secondHour);
    });

    it("rejects future-observed evidence for current reservations and dispatch", () => {
        const reading = input();
        reading.supply!.gridImportLimitKW = 2;
        reading.evidence.observedAt = "2026-10-28T13:01:00Z";
        const ledger = createSiteEnergyLedger(configuration(), [reading]);
        const before = ledger.state();
        expect(ledger.reserve({ version: before.version, load: load("a", 1) }).accepted).toBe(false);
        expect(ledger.dispatch({ window: firstHour, loads: [] }).feasible).toBe(false);
        expect(ledger.state()).toEqual(before);
    });

    it("returns an atomic failed assessment rather than mixing prefix meters with initial inventory", () => {
        const config = configuration(), first = input(), second = input(secondHour);
        config.storage.initial.storedKWh = 5;
        second.supply!.protectedKWh = 6;
        const ledger = createSiteEnergyLedger(config, [first, second]);
        const result = ledger.assess([load("a", 3)]);
        expect(result.feasible).toBe(false);
        expect(result.meters).toEqual([]);
        expect(result.usage).toEqual({});
        expect(result.inventory.storedKWh).toBe(5);
    });

    it("does not invent unknown grid burdens from binary64 solar allocation residuals", () => {
        const config = configuration(), reading = input();
        config.compute.kWPerGpu = .1;
        reading.supply!.solarKW = .3;
        reading.accounting.gridCarbonGPerKWh = undefined;
        reading.accounting.gridUsdPerMWh = undefined;
        const ledger = createSiteEnergyLedger(config, [reading]);
        const result = ledger.assess([load("a", 1), load("b", 1), load("c", 1)]);
        expect(result.feasible).toBe(true);
        expect(result.meters[0]).toMatchObject({ gridImportKWh: 0, carbonKg: 0, electricityUsd: 0 });
        expect(Object.values(result.usage).every(usage => usage.gridKWh === 0 && usage.carbonKg === 0 && usage.electricityUsd === 0)).toBe(true);
    });

    it("does not charge phantom solar after ten 0.1 kW loads consume 1 kWh", () => {
        const config = configuration(), reading = input();
        config.compute = { capGpus: 10, kWPerGpu: .1 };
        reading.supply!.solarKW = 1;
        const result = createSiteEnergyLedger(config, [reading]).assess(Array.from({ length: 10 }, (_, index) => load(`load-${index}`, 1)));
        expect(result.feasible).toBe(true);
        expect(result.meters[0]).toMatchObject({ solarKWh: 1, computeKWh: 1, batteryChargeKWh: 0, curtailedKWh: 0, endingStoredKWh: 0 });
    });

    it("uses one total for fixed plus compute when solar exactly covers their binary64 sum", () => {
        const config = configuration(), reading = input();
        config.compute.kWPerGpu = .2;
        reading.supply!.fixedLoadKW = .1;
        reading.supply!.solarKW = .1 + .2;
        const result = createSiteEnergyLedger(config, [reading]).assess([load("a", 1)]);
        expect(result.feasible).toBe(true);
        expect(result.meters[0]).toMatchObject({ batteryChargeKWh: 0, curtailedKWh: 0, endingStoredKWh: 0 });
    });

    it("preserves initial storage provenance and discharge losses in consumed and remaining burdens", () => {
        const config = configuration();
        config.storage.initial = { storedKWh: 1, carbonKg: .4, electricityUsd: .12 };
        config.storage.efficiency.discharge = .8;
        const partial = load("a", 1, { startAt: firstHour.startAt, endAt: "2026-10-28T12:24:00Z" });
        const ledger = createSiteEnergyLedger(config, [input()]);
        expect(ledger.reserve({ version: ledger.state().version, load: partial }).accepted).toBe(true);
        const result = ledger.dispatch({ window: firstHour, loads: [partial] });
        expect(result.feasible).toBe(true);
        expect(result.meters[0].batteryDischargeKWh).toBeCloseTo(.4);
        expect(result.meters[0].carbonKg).toBeCloseTo(.2);
        expect(result.meters[0].electricityUsd).toBeCloseTo(.06);
        expect(result.inventory.storedKWh).toBeCloseTo(.5);
        expect(result.inventory.carbonKg).toBeCloseTo(.2);
        expect(result.inventory.electricityUsd).toBeCloseTo(.06);
    });

    it("carries charged-source burdens through both efficiencies without booking them twice", () => {
        const config = configuration(), first = input(), second = input(secondHour);
        config.storage.efficiency = { charge: .8, discharge: .75 };
        first.supply!.solarKW = 4;
        first.accounting.solarCarbonGPerKWh = 50;
        first.accounting.solarUsdPerMWh = 40;
        const ledger = createSiteEnergyLedger(config, [first, second]);
        const charging = ledger.dispatch({ window: firstHour, loads: [] });
        expect(charging.feasible).toBe(true);
        expect(charging.meters[0]).toMatchObject({ batteryChargeKWh: 4, carbonKg: 0, electricityUsd: 0 });
        expect(charging.inventory.storedKWh).toBeCloseTo(3.2);
        expect(charging.inventory.carbonKg).toBeCloseTo(.2);
        expect(charging.inventory.electricityUsd).toBeCloseTo(.16);
        const actual = load("a", 3, { startAt: secondHour.startAt, endAt: "2026-10-28T13:48:00Z" });
        expect(ledger.reserve({ version: ledger.state().version, load: actual }).accepted).toBe(true);
        const discharging = ledger.dispatch({ window: secondHour, loads: [actual] });
        expect(discharging.feasible).toBe(true);
        expect(discharging.meters[0].carbonKg).toBeCloseTo(.2);
        expect(discharging.meters[0].electricityUsd).toBeCloseTo(.16);
        expect(discharging.inventory.storedKWh).toBeCloseTo(0);
        expect(discharging.meters[0].batteryChargeKWh).toBe(0);
    });

    it("keeps unknown carbon separate from known electricity expenditure", () => {
        const reading = input();
        reading.supply!.gridImportLimitKW = 2;
        reading.accounting.gridCarbonGPerKWh = undefined;
        const result = createSiteEnergyLedger(configuration(), [reading]).assess([load("a", 1)]);
        expect(result.feasible).toBe(true);
        expect(result.meters[0].carbonKg).toBeUndefined();
        expect(result.meters[0].electricityUsd).toBe(.1);
    });

    it("limits solar charging by capacity and curtails the remaining 8.75 kWh", () => {
        const config = configuration(), reading = input();
        config.storage.initial.storedKWh = 4;
        config.storage.limits.capacityKWh = 5;
        config.storage.efficiency.charge = .8;
        reading.supply!.solarKW = 10;
        const result = createSiteEnergyLedger(config, [reading]).dispatch({ window: firstHour, loads: [] });
        expect(result.feasible).toBe(true);
        expect(result.meters[0]).toMatchObject({ solarKWh: 10, batteryChargeKWh: 1.25, curtailedKWh: 8.75, endingStoredKWh: 5 });
        const meter = result.meters[0];
        expect(meter.solarKWh + meter.gridImportKWh + meter.batteryDischargeKWh)
            .toBe(meter.fixedLoadKWh + meter.computeKWh + meter.batteryChargeKWh + meter.curtailedKWh);
    });

    it("requires a feasible charging path to a future protected reserve", () => {
        const config = configuration(), first = input(), second = input(secondHour);
        config.storage.initial.storedKWh = 1;
        config.storage.efficiency.charge = .8;
        first.supply!.solarKW = 1;
        second.supply!.protectedKWh = 2;
        expect(createSiteEnergyLedger(config, [first, second]).assess([]).feasible).toBe(false);
        first.supply!.solarKW = 1.25;
        const ledger = createSiteEnergyLedger(config, [first, second]);
        expect(ledger.assess([]).inventory.storedKWh).toBe(2);
        expect(ledger.assess([load("a", 1, { startAt: firstHour.startAt, endAt: "2026-10-28T12:15:00Z" })]).feasible).toBe(false);
        expect(ledger.state().inventory.storedKWh).toBe(1);
    });

    it("revalidates a tightened import limit without committing a failed dispatch", () => {
        const reading = input();
        reading.supply!.gridImportLimitKW = 2;
        const ledger = createSiteEnergyLedger(configuration(), [reading]);
        expect(ledger.reserve({ version: ledger.state().version, load: load("a", 2) }).accepted).toBe(true);
        const changed = structuredClone(reading);
        changed.supply!.gridImportLimitKW = 1;
        changed.evidence.version = "reading-2";
        ledger.update(changed);
        const before = ledger.state();
        expect(ledger.dispatch({ window: firstHour, loads: [load("a", 2)] }).feasible).toBe(false);
        expect(ledger.state()).toEqual(before);
        expect(ledger.dispatch({ window: firstHour, loads: [load("a", 1)] }).feasible).toBe(true);
    });

    it("allows release and non-overlapping GPU reuse while rejecting stale/conflicting reservations", () => {
        const config = configuration(), reading = input();
        config.compute.capGpus = 1;
        reading.supply!.gridImportLimitKW = 1;
        const ledger = createSiteEnergyLedger(config, [reading]);
        const before = ledger.state().version;
        const a = load("a", 1, { startAt: firstHour.startAt, endAt: "2026-10-28T12:30:00Z" });
        const b = load("b", 1, { startAt: "2026-10-28T12:30:00Z", endAt: firstHour.endAt });
        expect(ledger.reserve({ version: before, load: a }).accepted).toBe(true);
        expect(ledger.reserve({ version: before, load: b }).accepted).toBe(false);
        expect(ledger.reserve({ version: ledger.state().version, load: b }).accepted).toBe(true);
        expect(ledger.reserve({ version: before, load: load("a", 1) }).accepted).toBe(false);
        expect(ledger.release("a")).toBe(true);
        const released = ledger.state();
        expect(ledger.release("a")).toBe(true);
        expect(ledger.state()).toEqual(released);
        expect(ledger.dispatch({ window: firstHour, loads: [b] }).meters[0].computeKWh).toBe(.5);
    });

    it("does not accept an impossible battery burst despite sufficient aggregate hourly energy", () => {
        const config = configuration(), reading = input();
        config.compute.kWPerGpu = 2;
        config.storage.initial.storedKWh = .1;
        reading.supply!.gridImportLimitKW = 1;
        const partial = load("a", 1, { startAt: firstHour.startAt, endAt: "2026-10-28T12:15:00Z" });
        expect(createSiteEnergyLedger(config, [reading]).assess([partial]).feasible).toBe(false);
    });

    it("keeps independent arms and returned objects detached from mutable caller state", () => {
        const config = configuration(), reading = input();
        config.storage.initial.storedKWh = 2;
        const baseline = createSiteEnergyLedger(config, [reading], quote), selected = createSiteEnergyLedger(config, [reading], quote);
        config.storage.initial.storedKWh = 99;
        reading.supply!.protectedKWh = 99;
        const result = selected.assess([load("a", 1)]);
        result.inventory.storedKWh = 99;
        result.meters[0].computeKWh = 99;
        const slots = selected.slots("site-A", firstHour);
        slots[0].slot!.availableEnergyKWh = 99;
        expect(selected.reserve({ version: selected.state().version, load: load("a", 1) }).accepted).toBe(true);
        const settled = selected.dispatch({ window: firstHour, loads: [load("a", 1)] });
        settled.meters[0].endingStoredKWh = 99;
        expect(selected.state().inventory.storedKWh).toBe(1);
        expect(baseline.state().inventory.storedKWh).toBe(2);
        expect(selected.dispatch({ window: firstHour, loads: [load("a", 1)] }).meters[0].endingStoredKWh).toBe(1);
    });

    it("requires a matching supplied quote without inventing free prices", () => {
        const reading = input();
        reading.supply!.gridImportLimitKW = 2;
        const without = createSiteEnergyLedger(configuration(), [reading]);
        expect(without.assess([load("a", 1)]).feasible).toBe(true);
        expect(without.slots("site-A", firstHour)[0].status).toBe("unavailable");
        const stale = createSiteEnergyLedger(configuration(), [reading], () => ({ version: "old", usdPerGpuHour: .01, basis: "Old quote" }));
        expect(stale.slots("site-A", firstHour)[0].status).toBe("unavailable");
        const current = createSiteEnergyLedger(configuration(), [reading], quote);
        const slot = current.slots("site-A", firstHour)[0];
        expect(slot.status).toBe("current");
        expect(slot.slot).toMatchObject({ availablePowerKW: 2, availableEnergyKWh: 2, postedUsdPerGpuHour: .1, priceBasis: "Supplied posted quote" });
    });
});
