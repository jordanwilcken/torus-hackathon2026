import type { SiteMeter } from "../../execution/SiteMeter.type.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SiteEnergyCalculation, SiteEnergyConfiguration, SiteEnergyFlow, SiteEnergyInput, SiteEnergyLoad, SiteEnergyUsage } from "./SiteEnergy.types.js";

export function windowBounds(window: TimeWindow): readonly [number, number] {
    const start = typeof window.startAt === "string" ? Date.parse(window.startAt) : NaN;
    const end = typeof window.endAt === "string" ? Date.parse(window.endAt) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new RangeError("Windows require valid timestamps and positive duration.");
    return [start, end];
}

function nonnegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative.`);
}

export function validateConfiguration(config: SiteEnergyConfiguration): void {
    if (!config.locationId || !config.accountingBasis) throw new RangeError("A location and accounting basis are required.");
    nonnegative(config.compute.capGpus, "GPU capacity");
    if (!Number.isInteger(config.compute.capGpus) || !Number.isFinite(config.compute.kWPerGpu) || config.compute.kWPerGpu <= 0)
        throw new RangeError("GPU count must be integral and power per GPU must be finite and positive.");
    for (const [label, value] of Object.entries(config.storage.limits)) nonnegative(value, label);
    for (const value of Object.values(config.storage.efficiency))
        if (!Number.isFinite(value) || value <= 0 || value > 1) throw new RangeError("Storage efficiencies must be in (0, 1].");
    for (const [label, value] of Object.entries(config.storage.initial)) if (value !== undefined) nonnegative(value, label);
    if (config.storage.initial.storedKWh > config.storage.limits.capacityKWh) throw new RangeError("Initial storage exceeds capacity.");
    if (config.storage.initial.storedKWh === 0 && ((config.storage.initial.carbonKg ?? 0) !== 0 || (config.storage.initial.electricityUsd ?? 0) !== 0))
        throw new RangeError("Empty storage cannot contain an acquisition burden.");
}

export function validateInput(input: SiteEnergyInput): void {
    windowBounds(input.window);
    const evidence = input.evidence;
    if (!evidence.source || !evidence.version || typeof evidence.observedAt !== "string" || !Number.isFinite(Date.parse(evidence.observedAt)) ||
        !["current", "stale", "unavailable"].includes(evidence.status) || typeof evidence.projected !== "boolean")
        throw new RangeError("Input evidence requires source, version, observation time and explicit status/projection.");
    if (input.supply) for (const [label, value] of Object.entries(input.supply)) nonnegative(value, label);
    for (const [label, value] of Object.entries(input.accounting)) if (value !== undefined) nonnegative(value, label);
}

export function validateLoad(load: SiteEnergyLoad): void {
    windowBounds(load.window);
    if (!load.id || !Number.isInteger(load.gpus) || load.gpus <= 0) throw new RangeError("A load requires an identity and a positive integral GPU count.");
}

export function emptyUsage(): SiteEnergyUsage {
    return { solarKWh: 0, batteryKWh: 0, gridKWh: 0, carbonKg: 0, electricityUsd: 0 };
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
    return left === undefined || right === undefined ? undefined : left + right;
}

export function combineUsage(left: SiteEnergyUsage, right: SiteEnergyUsage): SiteEnergyUsage {
    return {
        solarKWh: left.solarKWh + right.solarKWh, batteryKWh: left.batteryKWh + right.batteryKWh,
        gridKWh: left.gridKWh + right.gridKWh,
        carbonKg: sum(left.carbonKg, right.carbonKg), electricityUsd: sum(left.electricityUsd, right.electricityUsd),
    };
}

function burden(quantity: number, rate: number | undefined): number | undefined {
    return quantity === 0 ? 0 : rate === undefined ? undefined : quantity * rate;
}

/** Only absorbs binary64 rounding at a physical boundary, never a material extra allocation. */
function within(value: number, limit: number): boolean {
    return Number.isFinite(value) && value <= limit + 8 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(limit));
}

/** One shared physical model for planning, reservation checks and actual settlement. */
export function simulateSiteInterval(config: SiteEnergyConfiguration, calculation: SiteEnergyCalculation): SiteEnergyFlow {
    const { input, loads } = calculation;
    const initial = structuredClone(calculation.inventory);
    const inventory = structuredClone(initial);
    const failure = (reason: string): SiteEnergyFlow => ({ feasible: false, meters: [], inventory: initial, usage: {}, reason });
    const supply = input.supply;
    if (!supply || input.evidence.status !== "current") return failure("Local supply is missing, stale or unavailable.");
    if (supply.protectedKWh > inventory.storedKWh) return failure("Protected reserve exceeds current stored energy.");
    const [start, end] = windowBounds(input.window);
    const boundaries = new Set([start, end]);
    for (const load of loads) {
        validateLoad(load);
        const [from, to] = windowBounds(load.window);
        if (from < start || to > end) return failure("A load must fit one canonical input interval.");
        boundaries.add(from); boundaries.add(to);
    }
    const points = [...boundaries].sort((a, b) => a - b);
    const usage: Record<string, SiteEnergyUsage> = Object.create(null);
    const meter: SiteMeter = {
        locationId: config.locationId, window: { ...input.window }, solarKWh: 0, gridImportKWh: 0,
        batteryChargeKWh: 0, batteryDischargeKWh: 0, curtailedKWh: 0, fixedLoadKWh: 0, computeKWh: 0,
        endingStoredKWh: inventory.storedKWh, accountingBasis: config.accountingBasis, carbonKg: 0, electricityUsd: 0,
    };
    for (let index = 0; index < points.length - 1; index++) {
        const from = points[index], to = points[index + 1], hours = (to - from) / 3_600_000;
        const active = loads.filter(load => Date.parse(load.window.startAt) <= from && Date.parse(load.window.endAt) >= to);
        const gpus = active.reduce((total, load) => total + load.gpus, 0);
        if (gpus > config.compute.capGpus) return failure("Concurrent loads exceed GPU capacity.");
        const solar = supply.solarKW * hours, fixed = supply.fixedLoadKW * hours;
        const compute = gpus * config.compute.kWPerGpu * hours;
        const totalDemand = fixed + compute;
        const deficit = Math.max(0, totalDemand - solar);
        const discharge = Math.min(deficit, config.storage.limits.dischargeKW * hours,
            Math.max(0, inventory.storedKWh - supply.protectedKWh) * config.storage.efficiency.discharge);
        const requiredGrid = Math.max(0, deficit - discharge);
        if (!within(requiredGrid, supply.gridImportLimitKW * hours)) return failure("Active load exceeds import, discharge or available-energy limits.");
        const grid = Math.min(requiredGrid, supply.gridImportLimitKW * hours);
        const storedBefore = inventory.storedKWh;
        const withdrawn = Math.min(Math.max(0, storedBefore - supply.protectedKWh), discharge / config.storage.efficiency.discharge);
        const fraction = storedBefore > 0 ? withdrawn / storedBefore : 0;
        const batteryCarbon = burden(fraction, inventory.carbonKg), batteryCost = burden(fraction, inventory.electricityUsd);
        inventory.storedKWh = Math.max(supply.protectedKWh, storedBefore - withdrawn);
        inventory.carbonKg = inventory.storedKWh === 0 ? 0 : inventory.carbonKg === undefined ? undefined : inventory.carbonKg - (batteryCarbon ?? 0);
        inventory.electricityUsd = inventory.storedKWh === 0 ? 0 : inventory.electricityUsd === undefined ? undefined : inventory.electricityUsd - (batteryCost ?? 0);
        const surplusSolar = Math.max(0, solar - totalDemand);
        let remainingSolar = Math.min(solar, totalDemand), remainingBattery = discharge, remainingGrid = grid;
        // Fixed load, then accepted reservations, then proposed work receive source attribution.
        const consume = (demand: number): SiteEnergyUsage => {
            const solarKWh = Math.min(demand, remainingSolar);
            remainingSolar -= solarKWh;
            const batteryKWh = Math.min(demand - solarKWh, remainingBattery);
            remainingBattery -= batteryKWh;
            const gridKWh = Math.min(Math.max(0, demand - solarKWh - batteryKWh), remainingGrid);
            remainingGrid -= gridKWh;
            return {
                solarKWh, batteryKWh, gridKWh,
                carbonKg: sum(sum(burden(solarKWh, input.accounting.solarCarbonGPerKWh === undefined ? undefined : input.accounting.solarCarbonGPerKWh / 1000),
                    burden(gridKWh, input.accounting.gridCarbonGPerKWh === undefined ? undefined : input.accounting.gridCarbonGPerKWh / 1000)),
                    burden(discharge === 0 ? 0 : batteryKWh / discharge, batteryCarbon)),
                electricityUsd: sum(sum(burden(solarKWh, input.accounting.solarUsdPerMWh === undefined ? undefined : input.accounting.solarUsdPerMWh / 1000),
                    burden(gridKWh, input.accounting.gridUsdPerMWh === undefined ? undefined : input.accounting.gridUsdPerMWh / 1000)),
                    burden(discharge === 0 ? 0 : batteryKWh / discharge, batteryCost)),
            };
        };
        let consumed = consume(fixed);
        for (const load of active) {
            const supplied = consume(load.gpus * config.compute.kWPerGpu * hours);
            usage[load.id] = combineUsage(usage[load.id] ?? emptyUsage(), supplied);
            consumed = combineUsage(consumed, supplied);
        }
        const charge = Math.max(0, Math.min(surplusSolar, config.storage.limits.chargeKW * hours,
            (config.storage.limits.capacityKWh - inventory.storedKWh) / config.storage.efficiency.charge));
        inventory.storedKWh = Math.min(config.storage.limits.capacityKWh, inventory.storedKWh + charge * config.storage.efficiency.charge);
        inventory.carbonKg = sum(inventory.carbonKg, burden(charge, input.accounting.solarCarbonGPerKWh === undefined ? undefined : input.accounting.solarCarbonGPerKWh / 1000));
        inventory.electricityUsd = sum(inventory.electricityUsd, burden(charge, input.accounting.solarUsdPerMWh === undefined ? undefined : input.accounting.solarUsdPerMWh / 1000));
        meter.solarKWh += solar; meter.gridImportKWh += grid; meter.batteryChargeKWh += charge;
        meter.batteryDischargeKWh += discharge; meter.curtailedKWh += Math.max(0, surplusSolar - charge);
        meter.fixedLoadKWh += fixed; meter.computeKWh += compute; meter.endingStoredKWh = inventory.storedKWh;
        meter.carbonKg = sum(meter.carbonKg, consumed.carbonKg); meter.electricityUsd = sum(meter.electricityUsd, consumed.electricityUsd);
        const physical = [meter.solarKWh, meter.gridImportKWh, meter.batteryChargeKWh, meter.batteryDischargeKWh,
            meter.curtailedKWh, meter.fixedLoadKWh, meter.computeKWh, inventory.storedKWh,
            inventory.carbonKg, inventory.electricityUsd, meter.carbonKg, meter.electricityUsd];
        if (physical.some(value => value !== undefined && !Number.isFinite(value))) return failure("Energy or accounting calculation overflowed.");
    }
    return { feasible: true, meters: [meter], inventory, usage };
}
