import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SiteEnergy } from "../SiteEnergy.interface.js";
import type { SiteMeter } from "../../execution/SiteMeter.type.js";

export type EnergyInventory = {
    storedKWh: number;
    carbonKg?: number;
    electricityUsd?: number;
};

export type SiteEnergyConfiguration = {
    locationId: string;
    compute: { capGpus: number; kWPerGpu: number };
    storage: {
        initial: EnergyInventory;
        limits: { capacityKWh: number; chargeKW: number; dischargeKW: number };
        efficiency: { charge: number; discharge: number };
    };
    /** Consumption accounting: charging burdens remain in inventory until discharge. */
    accountingBasis: string;
};

export type SiteEnergySupply = {
    solarKW: number;
    fixedLoadKW: number;
    gridImportLimitKW: number;
    protectedKWh: number;
};

export type SiteEnergyInput = {
    window: TimeWindow;
    supply?: SiteEnergySupply;
    evidence: {
        source: string;
        version: string;
        observedAt: string;
        status: "current" | "stale" | "unavailable";
        projected: boolean;
    };
    accounting: {
        solarCarbonGPerKWh?: number;
        gridCarbonGPerKWh?: number;
        solarUsdPerMWh?: number;
        gridUsdPerMWh?: number;
    };
};

/** A constant compute load during its actual active window, within one canonical tick. */
export type SiteEnergyLoad = { id: string; window: TimeWindow; gpus: number };
export type SiteEnergyReservation = { version: string; load: SiteEnergyLoad };
export type SiteEnergyTick = { window: TimeWindow; loads: readonly SiteEnergyLoad[] };
export type SiteEnergyReservationResult = { accepted: boolean; version: string; reason?: string };

export type SiteEnergyUsage = {
    solarKWh: number;
    gridKWh: number;
    batteryKWh: number;
    carbonKg?: number;
    electricityUsd?: number;
};

export type SiteEnergyState = { version: string; nextWindow?: TimeWindow; inventory: EnergyInventory };
export type SiteEnergyAssessment = {
    feasible: boolean;
    version: string;
    meters: SiteMeter[];
    inventory: EnergyInventory;
    usage: Record<string, SiteEnergyUsage>;
    reason?: string;
};
export type SiteEnergyFlow = Omit<SiteEnergyAssessment, "version">;
export type SiteEnergyCalculation = {
    input: SiteEnergyInput;
    inventory: EnergyInventory;
    loads: readonly SiteEnergyLoad[];
};

/** Remaining capacity under the explicitly conservative, earlier-offers-consumed rollout. */
export type SiteEnergyOffer = {
    version: string;
    window: TimeWindow;
    capGpus: number;
    usedGpus: number;
    availablePowerKW: number;
    availableEnergyKWh: number;
    supply: SiteEnergyUsage;
};
export type SiteEnergyQuote = { version: string; usdPerGpuHour: number; basis: string };
/** Pure for one offer/revision. Call refreshPublication when external pricing policy changes. */
export type SiteEnergyQuoteProvider = (offer: SiteEnergyOffer) => SiteEnergyQuote | undefined;

export interface SiteEnergyLedger extends SiteEnergy {
    state(): SiteEnergyState;
    /** Explicit loads are added to current reservations; only copied inventory advances. */
    assess(plan: readonly SiteEnergyLoad[]): SiteEnergyAssessment;
    reserve(request: SiteEnergyReservation): SiteEnergyReservationResult;
    release(reservationId: string): boolean;
    /** Unlisted reservations consume no compute; every canonical tick still meters fixed load. */
    dispatch(tick: SiteEnergyTick): SiteEnergyAssessment;
    /** Replace unsettled input with a newer version; existing reservations are revalidated at dispatch. */
    update(input: SiteEnergyInput): void;
    /** Invalidate published quotes and old selection versions without changing physical readings. */
    refreshPublication(): void;
}
