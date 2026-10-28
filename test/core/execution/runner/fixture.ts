import { createSiteEnergyLedger } from "../../../../src/core/energy/site/createSiteEnergyLedger.js";
import { createExecutor } from "../../../../src/core/execution/runner/createExecutor.js";
import type { SiteEnergyConfiguration, SiteEnergyInput } from "../../../../src/core/energy/site/SiteEnergy.types.js";
import type { Job } from "../../../../src/core/jobs/Job.type.js";
import type { SelectedJobOutcome } from "../../../../src/core/scheduling/JobOutcome.type.js";
import type { TimeWindow } from "../../../../src/core/TimeWindow.type.js";

export const basis = "Supplied simulation; operational consumption accounting";
export const priceBasis = "Supplied posted USD per GPU-hour";
export const at = (hour: number): string => new Date(Date.parse("2026-10-28T12:00:00Z") + hour * 3_600_000).toISOString();
export const hour = (index: number): TimeWindow => ({ startAt: at(index), endAt: at(index + 1) });

type SiteOptions = {
    kWhPerGpuHour?: number;
    computeProfile?: string;
    capGpus?: number;
    fixedLoadKW?: number;
    gridImportLimitKW?: number;
    storedKWh?: number;
    protectedKWh?: number;
    hours?: number;
    rate?: number;
    observedAt?: string;
    evidenceStatus?: SiteEnergyInput["evidence"]["status"];
    projected?: boolean;
};

/** Only supplied readings/quotes live here. All reservation and dispatch behavior is real. */
export function site(locationId: string, options: SiteOptions = {}) {
    const kWhPerGpuHour = options.kWhPerGpuHour ?? 0.85;
    const readings: SiteEnergyInput[] = Array.from({ length: options.hours ?? 7 }, (_, index) => ({
        window: hour(index),
        supply: { solarKW: 0, fixedLoadKW: options.fixedLoadKW ?? 0,
            gridImportLimitKW: options.gridImportLimitKW ?? 3, protectedKWh: options.protectedKWh ?? 0 },
        evidence: { source: "supplied executor scenario", version: `${locationId}-reading-${index}`,
            observedAt: options.observedAt ?? at(index), status: options.evidenceStatus ?? "current", projected: options.projected ?? false },
        accounting: { solarCarbonGPerKWh: 0, gridCarbonGPerKWh: 400, solarUsdPerMWh: 0, gridUsdPerMWh: 50 },
    }));
    const configuration: SiteEnergyConfiguration = {
        locationId, compute: { capGpus: options.capGpus ?? 2, kWPerGpu: kWhPerGpuHour },
        storage: {
            initial: { storedKWh: options.storedKWh ?? 0, carbonKg: 0, electricityUsd: 0 },
            limits: { capacityKWh: 10, chargeKW: 10, dischargeKW: 10 },
            efficiency: { charge: 1, discharge: 1 },
        },
        accountingBasis: basis,
    };
    const quote = { rate: options.rate ?? 1, basis: priceBasis };
    const ledger = createSiteEnergyLedger(configuration, readings,
        offer => ({ version: offer.version, usdPerGpuHour: quote.rate, basis: quote.basis }));
    const executionSite = { locationId, computeProfile: options.computeProfile ?? "gpu",
        kWhPerGpuHour, accountingBasis: basis, ledger };
    return { executionSite, ledger, quote, readings,
        update(index: number, change: (reading: SiteEnergyInput) => void): void {
            const reading = structuredClone(readings[index]);
            reading.evidence.version += "-changed";
            change(reading);
            ledger.update(reading);
            readings[index] = reading;
        },
    };
}

export type SuppliedSite = ReturnType<typeof site>;

export function job(overrides: Partial<Job> = {}): Job {
    return {
        id: "batch", workloadRef: "supplied checkpointable batch", computeProfile: "gpu",
        window: { startAt: at(0), endAt: at(6) }, allowedLocations: ["A", "B"],
        homeLocation: "A", currentLocation: "A", readyAt: at(0),
        workGpuH: 2, remainingGpuH: 2, maxGpus: 1, dataGB: 10, state: "queued",
        ...overrides,
    };
}

/** Construct a supplied selection using the actual public quote and slot identity. */
export function selection(submitted: Job, suppliedSite: SuppliedSite, index = 0,
    quantities: { gpus: number; estimatedKWh: number; window?: TimeWindow } = { gpus: 1, estimatedKWh: 0.85 }): SelectedJobOutcome {
    const reading = suppliedSite.ledger.slots(suppliedSite.executionSite.locationId, hour(index))[0];
    if (!reading?.slot || !reading.version) throw new Error("The supplied selection needs an identifiable quoted slot.");
    return {
        selected: true, explanation: "Supplied selection for executor acceptance.",
        allocation: {
            jobId: submitted.id, slot: { locationId: reading.slot.locationId, slotId: reading.slot.id },
            slotVersion: reading.version, allocatedGpus: quantities.gpus,
            kWhPerGpuHour: suppliedSite.executionSite.kWhPerGpuHour,
            requiredPowerKW: quantities.gpus * suppliedSite.executionSite.kWhPerGpuHour,
            energy: [{ window: quantities.window ?? hour(index), estimatedKWh: quantities.estimatedKWh }],
            forecast: {}, postedUsdPerGpuHour: reading.slot.postedUsdPerGpuHour, priceBasis: reading.slot.priceBasis,
        },
    };
}

export function executor(submitted: readonly Job[], suppliedSites: readonly SuppliedSite[],
    transferTerms: Parameters<typeof createExecutor>[0]["transferTerms"] = () => ({
        bandwidthGBPerHour: 20, kWhPerGB: 0.02, accountingBasis: basis,
        jobChargeUsdPerGB: 0.03, carbonGPerKWh: 400, electricityUsdPerMWh: 50,
    })) {
    return createExecutor({ jobs: submitted, sites: suppliedSites.map(value => value.executionSite),
        maximumAgeMinutes: 5, transferTerms });
}
