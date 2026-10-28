/** Assessed energy for the complete quantity being priced. Supply includes storage/conversion losses. */
export type PricedEnergySource = {
  deliveredKWh: number;
  supplyKWh: number;
  usdPerMWh?: number;
  gramsCO2PerKWh?: number;
  /** Present only for energy acquired at this slot's demand-scaled grid rate. */
  gridDemand?: { demandMW: number; averageDemandMW: number };
};

/** Prepared numeric inputs: finite nonnegative values, positive average demand,
 * and supply energy including all delivered energy and attributed losses.
 * Work, required energy and the mix describe the same complete assessed capacity.
 * The caller owns freshness, slot/version identity, physical limits and metadata. */
export type SitePriceInput = {
  remainingGpuHours: number;
  requiredEnergyKWh: number;
  sources: readonly PricedEnergySource[];
  carbonPriceUsdPerTonne: number;
};

export type SitePriceResult = {
  status: "posted";
  postedUsdPerGpuHour: number;
  electricityUsd: number;
  carbonKg: number;
  carbonChargeUsd: number;
} | {
  status: "unavailable";
  reason: string;
};
