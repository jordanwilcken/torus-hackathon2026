import type { AssessedUsagePriceInput, SitePriceResult } from "./SitePrice.type.js";
import * as math from "./math/postSitePrice.generated.js";

/** Apply the pricing policy once to burdens for the complete assessed work quantity. */
export function priceAssessedUsage({ remainingGpuHours, electricityUsd, carbonKg, carbonPriceUsdPerTonne }: AssessedUsagePriceInput): SitePriceResult {
  if (!Number.isFinite(remainingGpuHours) || remainingGpuHours <= 0)
    return { status: "unavailable", reason: "No representable remaining compute capacity." };
  if (electricityUsd === undefined || carbonKg === undefined)
    return { status: "unavailable", reason: "Energy cost and carbon burden must be known for the full quantity." };
  const carbonChargeUsd = math.modeledCarbonCharge({ carbonKg, carbonPriceUsdPerTonne });
  const postedUsdPerGpuHour = math.postedUsdPerGpuHour({ electricityUsd, carbonChargeUsd, remainingGpuHours });
  const price = { postedUsdPerGpuHour, electricityUsd, carbonKg, carbonChargeUsd };
  if (Object.values(price).some(value => !Number.isFinite(value)))
    return { status: "unavailable", reason: "The modeled price exceeds the supported numeric range." };
  return { status: "posted", ...price };
}
