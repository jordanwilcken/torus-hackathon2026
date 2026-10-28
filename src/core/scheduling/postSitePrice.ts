import type { SitePriceInput, SitePriceResult } from "./SitePrice.type.js";
import * as math from "./math/postSitePrice.generated.js";
import { priceAssessedUsage } from "./priceAssessedUsage.js";

/** Price an assessed quantity without reserving energy or publishing a slot. */
export function postSitePrice({ remainingGpuHours, requiredEnergyKWh, sources, carbonPriceUsdPerTonne }: SitePriceInput): SitePriceResult {
  if (remainingGpuHours <= 0 || requiredEnergyKWh <= 0)
    return { status: "unavailable", reason: "No usable remaining compute capacity." };

  const deliveredKWh = math.sourceTotal({ values: sources.map(source => source.deliveredKWh) });
  if (!Number.isFinite(deliveredKWh) || !math.quantitiesMatch({ actual: deliveredKWh, expected: requiredEnergyKWh }))
    return { status: "unavailable", reason: "The energy mix must cover the full required quantity." };

  const charges: Array<[number, number]> = [];
  for (const source of sources) {
    const { usdPerMWh, gramsCO2PerKWh } = source;
    if (usdPerMWh === undefined || gramsCO2PerKWh === undefined)
      return { status: "unavailable", reason: "Energy cost and carbon burden must be known for the full quantity." };
    const rate = source.gridDemand ? math.gridEnergyRate({ ...source.gridDemand, usdPerMWh }) : usdPerMWh;
    charges.push(math.sourceCharges({ supplyKWh: source.supplyKWh, usdPerMWh: rate, gramsCO2PerKWh }));
  }

  return priceAssessedUsage({
    remainingGpuHours, carbonPriceUsdPerTonne,
    electricityUsd: math.sourceTotal({ values: charges.map(([electricity]) => electricity) }),
    carbonKg: math.sourceTotal({ values: charges.map(([, carbon]) => carbon) }),
  });
}
