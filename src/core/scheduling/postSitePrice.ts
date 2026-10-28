import type { SitePriceInput, SitePriceResult } from "./SitePrice.type.js";

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative.`);
  return value;
}

function positive(value: number, name: string) {
  nonnegative(value, name);
  if (value === 0) throw new RangeError(`${name} must be positive.`);
  return value;
}

function sameQuantity(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}

function wholeGpus(available: number, perGpu: number) {
  const ratio = available / perGpu;
  const rounded = Math.round(ratio);
  return sameQuantity(ratio, rounded) ? rounded : Math.floor(ratio);
}

/** Price supplied capacity without reserving it. Dispatch and energy feasibility belong to the ledger.
 * Missing/stale/mismatched evidence returns unavailable; invalid numeric inputs throw RangeError. */
export function postSitePrice(input: SitePriceInput): SitePriceResult {
  const snapshot = structuredClone(input.snapshot);
  const forecast = structuredClone(input.forecast);
  const unavailable = (reason: string): SitePriceResult => ({ status: "unavailable", reason, sourceSnapshot: snapshot, forecast });
  const kWhPerGpuHour = positive(input.profile.kWhPerGpuHour, "kWhPerGpuHour");
  const powerPerGpu = positive(input.profile.activePowerKWPerGpu, "activePowerKWPerGpu");
  const carbonPrice = nonnegative(input.carbonPriceUsdPerTonne, "carbonPriceUsdPerTonne");

  if (snapshot.status !== "current") return unavailable(`Local energy evidence is ${snapshot.status}.`);
  const slot = snapshot.slot;
  if (!slot || !snapshot.version?.trim() || !snapshot.observedAt || !snapshot.source.trim())
    return unavailable("A slot, capacity version, observation time and source are required.");
  const start = Date.parse(slot.window.startAt), end = Date.parse(slot.window.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(Date.parse(snapshot.observedAt)))
    throw new RangeError("Slot timestamps must be valid and the window must have positive duration.");
  for (const [name, value] of Object.entries({ capGpus: slot.capGpus, usedGpus: slot.usedGpus })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer.`);
  }
  if (slot.usedGpus > slot.capGpus) throw new RangeError("usedGpus cannot exceed capGpus.");
  nonnegative(slot.availablePowerKW, "availablePowerKW");
  nonnegative(slot.availableEnergyKWh, "availableEnergyKWh");
  const hours = (end - start) / 3_600_000;
  const remainingGpus = Math.min(slot.capGpus - slot.usedGpus,
    wholeGpus(slot.availablePowerKW, powerPerGpu));
  if (remainingGpus === 0 || slot.availableEnergyKWh === 0) return unavailable("No usable remaining compute capacity.");
  const remainingGpuHours = positive(Math.min(remainingGpus * hours, slot.availableEnergyKWh / kWhPerGpuHour), "remainingGpuHours");
  const requiredKWh = positive(remainingGpuHours * kWhPerGpuHour, "requiredKWh");
  const requiredPowerKW = positive(remainingGpus * powerPerGpu, "requiredPowerKW");

  const assessment = input.assessment;
  if (!assessment) return unavailable("The full remaining quantity needs a supplied energy assessment.");
  if (assessment.slot.locationId !== slot.locationId || assessment.slot.slotId !== slot.id || assessment.slotVersion !== snapshot.version)
    return unavailable("The energy assessment must match this slot and capacity version.");
  nonnegative(assessment.remainingGpuHours, "assessed remainingGpuHours");
  if (!sameQuantity(assessment.remainingGpuHours, remainingGpuHours))
    return unavailable("The energy assessment must cover the full remaining GPU-hour quantity.");
  if (!assessment.source.trim() || !assessment.carbonBasis.trim())
    return unavailable("Energy source and carbon accounting basis must be known.");

  let deliveredKWh = 0, electricityUsd = 0, carbonKg = 0;
  for (const source of assessment.sources) {
    nonnegative(source.deliveredKWh, "deliveredKWh");
    nonnegative(source.supplyKWh, "supplyKWh");
    if (source.supplyKWh < source.deliveredKWh && !sameQuantity(source.supplyKWh, source.deliveredKWh))
      throw new RangeError("Supply energy must include all delivered energy and attributed losses.");
    if (!source.source.trim() || source.usdPerMWh === undefined || source.gramsCO2PerKWh === undefined)
      return unavailable("Energy acquisition cost, carbon burden and source must be known for the full quantity.");
    let usdPerMWh = nonnegative(source.usdPerMWh, "usdPerMWh");
    const gramsCO2PerKWh = nonnegative(source.gramsCO2PerKWh, "gramsCO2PerKWh");
    if (source.gridDemand) {
      const demand = nonnegative(source.gridDemand.demandMW, "demandMW");
      const average = positive(source.gridDemand.averageDemandMW, "averageDemandMW");
      usdPerMWh *= demand / average;
    }
    deliveredKWh += source.deliveredKWh;
    electricityUsd += source.supplyKWh * usdPerMWh / 1000;
    carbonKg += source.supplyKWh * gramsCO2PerKWh / 1000;
  }
  if (!sameQuantity(deliveredKWh, requiredKWh))
    return unavailable("Delivered energy must cover exactly the full remaining quantity.");
  const carbonChargeUsd = nonnegative(carbonKg * carbonPrice / 1000, "carbonChargeUsd");
  nonnegative(electricityUsd, "electricityUsd");
  nonnegative(carbonKg, "carbonKg");
  const rate = nonnegative((electricityUsd + carbonChargeUsd) / remainingGpuHours, "postedUsdPerGpuHour");

  slot.capGpus = slot.usedGpus + remainingGpus;
  slot.availablePowerKW = Math.min(slot.availablePowerKW, requiredPowerKW);
  slot.availableEnergyKWh = Math.min(slot.availableEnergyKWh, requiredKWh);
  slot.postedUsdPerGpuHour = rate;
  slot.priceBasis = `modeled energy + carbon at USD ${carbonPrice}/tCO2; ${assessment.carbonBasis}; full remaining ${remainingGpuHours} GPU-hours; ${assessment.source}`;
  return {
    status: "posted", snapshot, forecast, assessment: structuredClone(assessment),
    estimate: {
      remainingGpus, remainingGpuHours, requiredPowerKW,
      energy: { window: { ...slot.window }, estimatedKWh: requiredKWh },
      electricityUsd, carbonKg, carbonChargeUsd,
    },
  };
}
