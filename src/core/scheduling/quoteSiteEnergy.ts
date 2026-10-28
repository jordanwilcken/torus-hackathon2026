import type { SiteEnergyPriceOffer, SiteEnergyPricePolicy, SiteEnergyPriceQuote } from "./SiteEnergyPrice.type.js";
import { priceAssessedUsage } from "./priceAssessedUsage.js";
import { gpuHoursForEnergy } from "./math/postSitePrice.generated.js";

/** Quote the same full assessed offer. Supply burdens already include grid terms and storage losses.
 * The ledger owns publication; call its refreshPublication() when the pricing policy changes. */
export function quoteSiteEnergy(offer: SiteEnergyPriceOffer, policy: SiteEnergyPricePolicy): SiteEnergyPriceQuote | undefined {
  const remainingGpuHours = gpuHoursForEnergy({ availableEnergyKWh: offer.availableEnergyKWh, kWhPerGpuHour: policy.kWhPerGpuHour });
  const price = priceAssessedUsage({ ...offer.supply, remainingGpuHours, carbonPriceUsdPerTonne: policy.carbonPriceUsdPerTonne });
  if (price.status === "unavailable") return undefined;
  return {
    version: offer.version, usdPerGpuHour: price.postedUsdPerGpuHour,
    basis: `modeled electricity + carbon at USD ${policy.carbonPriceUsdPerTonne}/tCO2; ${policy.accountingBasis}; full remaining ${remainingGpuHours} GPU-hours`,
  };
}
