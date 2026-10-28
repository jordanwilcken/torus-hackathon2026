import type { SlotSnapshot } from "../energy/SlotSnapshot.type.js";
import type { SlotForecast } from "../energy/SlotForecast.type.js";
import type { SlotReference } from "../energy/SlotReference.type.js";
import type { EnergyUse } from "./EnergyUse.type.js";

/** A ledger-supplied portion of the full remaining quantity. Pricing never chooses dispatch. */
export type PricedEnergySource = {
  source: string;
  deliveredKWh: number;
  /** Upstream energy, including attributed storage/conversion losses. */
  supplyKWh: number;
  /** Acquisition rate for local/stored energy; base regional rate for current grid energy. */
  usdPerMWh?: number;
  gramsCO2PerKWh?: number;
  /** Apply only to energy acquired at this slot's demand-scaled regional rate. */
  gridDemand?: { demandMW: number; averageDemandMW: number };
};

export type SitePriceAssessment = {
  slot: SlotReference;
  slotVersion: string;
  remainingGpuHours: number;
  source: string;
  carbonBasis: string;
  sources: PricedEnergySource[];
};

export type SitePriceInput = {
  /** Cap/used come from the planner; available power/energy already exclude protected/committed energy.
   * Caller supplies a new version whenever capacity, mix, pricing assumptions, profile or forecasts change. */
  snapshot: SlotSnapshot;
  forecast: SlotForecast;
  profile: { kWhPerGpuHour: number; activePowerKWPerGpu: number };
  carbonPriceUsdPerTonne: number;
  assessment?: SitePriceAssessment;
};

export type SitePriceResult = {
  status: "posted";
  /** A fresh snapshot capped to this compute profile's usable remaining quantity. */
  snapshot: SlotSnapshot;
  forecast: SlotForecast;
  assessment: SitePriceAssessment;
  estimate: {
    /** Concurrent GPU limit; energy may support less than a full slot at this count. */
    remainingGpus: number;
    remainingGpuHours: number;
    requiredPowerKW: number;
    energy: EnergyUse;
    electricityUsd: number;
    carbonKg: number;
    carbonChargeUsd: number;
  };
} | {
  status: "unavailable";
  reason: string;
  sourceSnapshot: SlotSnapshot;
  forecast: SlotForecast;
};
