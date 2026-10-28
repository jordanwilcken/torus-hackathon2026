import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SiteEnergyConfiguration, SiteEnergyInput, SiteEnergyLoad, SiteEnergyPeriod } from "./SiteEnergy.types.js";

export function windowBounds(window: TimeWindow): readonly [number, number] {
    const start = typeof window.startAt === "string" ? Date.parse(window.startAt) : NaN;
    const end = typeof window.endAt === "string" ? Date.parse(window.endAt) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new RangeError("Windows require valid timestamps and positive duration.");
    return [start, end];
}

export function windowKey(window: TimeWindow): string {
    return windowBounds(window).join("/");
}

export function containsWindow(outer: TimeWindow, inner: TimeWindow): boolean {
    const [start, end] = windowBounds(outer), [from, to] = windowBounds(inner);
    return from >= start && to <= end;
}

export function loadIdentity(load: SiteEnergyLoad): readonly [string, number, number, number] {
    return [load.id, load.gpus, ...windowBounds(load.window)];
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

/** Parse the boundary once; the physical model receives numeric, constant-load periods. */
export function prepareSitePeriods(window: TimeWindow, loads: readonly SiteEnergyLoad[]): SiteEnergyPeriod[] {
    const [start, end] = windowBounds(window);
    const boundaries = new Set([start, end]);
    const prepared = loads.map(load => {
        validateLoad(load);
        const [from, to] = windowBounds(load.window);
        if (from < start || to > end) throw new RangeError("A load must fit one canonical input interval.");
        boundaries.add(from);
        boundaries.add(to);
        return { id: load.id, gpus: load.gpus, from, to };
    });
    const points = [...boundaries].sort((a, b) => a - b);
    return points.slice(0, -1).map((from, index) => {
        const to = points[index + 1];
        const active = prepared.filter(load => load.from <= from && load.to >= to);
        return {
            hours: (to - from) / 3_600_000,
            gpus: active.reduce((total, load) => total + load.gpus, 0),
            loads: active.map(({ id, gpus }) => ({ id, gpus })),
        };
    });
}
