/** The pricing projection of a ledger's complete remaining offer, including carried losses/costs. */
export type SiteEnergyPriceOffer = {
  version: string;
  availableEnergyKWh: number;
  supply: { electricityUsd?: number; carbonKg?: number };
};

export type SiteEnergyPricePolicy = {
  /** Match the site's compute profile; the ledger's constant-power model uses compute.kWPerGpu. */
  kWhPerGpuHour: number;
  carbonPriceUsdPerTonne: number;
  /** The same carbon accounting basis used to assess the offer. */
  accountingBasis: string;
};

/** Structurally compatible with the ledger's injected SiteEnergyQuoteProvider result. */
export type SiteEnergyPriceQuote = { version: string; usdPerGpuHour: number; basis: string };
