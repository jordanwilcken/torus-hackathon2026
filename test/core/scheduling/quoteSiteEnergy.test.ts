import { expect, test } from "vitest";
import { quoteSiteEnergy } from "../../../src/core/scheduling/quoteSiteEnergy.js";
import type { SiteEnergyPriceOffer, SiteEnergyPricePolicy } from "../../../src/core/scheduling/SiteEnergyPrice.type.js";

const policy: SiteEnergyPricePolicy = {
  kWhPerGpuHour: 1, carbonPriceUsdPerTonne: 100, accountingBasis: "supplied operational CO2 with carried storage burdens",
};

function offer(): SiteEnergyPriceOffer {
  return { version: "site-A:7", availableEnergyKWh: 4, supply: { electricityUsd: 0.18, carbonKg: 1.2 } };
}

test("quotes the full assessed mix and keeps the ledger revision and declared basis", () => {
  const quote = quoteSiteEnergy(offer(), policy);

  expect(quote?.usdPerGpuHour).toBeCloseTo(0.075, 12);
  expect(quote?.version).toBe("site-A:7");
  expect(quote?.basis).toContain("modeled electricity + carbon");
  expect(quote?.basis).toContain(policy.accountingBasis);
  expect(quote?.basis).toContain("4 GPU-hours");
});

test("carried storage losses and acquisition costs are charged exactly once", () => {
  const quote = quoteSiteEnergy({ ...offer(), supply: { electricityUsd: 0.25, carbonKg: 2 } }, policy);

  expect(quote?.usdPerGpuHour).toBeCloseTo(0.1125, 12);
});

test("a fractional offered quantity keeps the compute profile's per-GPU-hour rate", () => {
  const quote = quoteSiteEnergy({
    version: "site-A:8", availableEnergyKWh: 0.2125, supply: { electricityUsd: 0.01275, carbonKg: 0.085 },
  }, { ...policy, kWhPerGpuHour: 0.85 });

  expect(quote?.usdPerGpuHour).toBeCloseTo(0.085, 12);
  expect(quote?.basis).toContain("0.25 GPU-hours");
});

test("updated quantities and policies return a quote for the supplied new revision", () => {
  const first = quoteSiteEnergy(offer(), policy);
  const remaining = { ...offer(), version: "site-A:8", availableEnergyKWh: 3 };
  const next = quoteSiteEnergy(remaining, policy);
  const noCarbonCharge = quoteSiteEnergy({ ...remaining, version: "site-A:9" }, { ...policy, carbonPriceUsdPerTonne: 0 });

  expect(first?.usdPerGpuHour).toBeCloseTo(0.075, 12);
  expect(next?.usdPerGpuHour).toBeCloseTo(0.10, 12);
  expect(next?.version).toBe("site-A:8");
  expect(noCarbonCharge?.usdPerGpuHour).toBeCloseTo(0.06, 12);
  expect(noCarbonCharge?.version).toBe("site-A:9");
});

test("no usable energy and unknown burdens provide no quote", () => {
  expect(quoteSiteEnergy({ ...offer(), availableEnergyKWh: 0 }, policy)).toBeUndefined();
  expect(quoteSiteEnergy({ ...offer(), supply: { carbonKg: 1.2 } }, policy)).toBeUndefined();
  expect(quoteSiteEnergy({ ...offer(), supply: { electricityUsd: 0.18 } }, { ...policy, carbonPriceUsdPerTonne: 0 })).toBeUndefined();
});

test("known free clean supply still provides a real zero-price quote", () => {
  const quote = quoteSiteEnergy({ ...offer(), supply: { electricityUsd: 0, carbonKg: 0 } }, policy);
  expect(quote?.usdPerGpuHour).toBe(0);
  expect(quote?.version).toBe("site-A:7");
});

test("unrepresentable computed work or carbon charge provides no quote", () => {
  expect(quoteSiteEnergy({ ...offer(), availableEnergyKWh: 1e308 }, { ...policy, kWhPerGpuHour: 1e-308 })).toBeUndefined();
  expect(quoteSiteEnergy({ ...offer(), supply: { electricityUsd: 0, carbonKg: 1e308 } }, {
    ...policy, carbonPriceUsdPerTonne: 1e308,
  })).toBeUndefined();
});

test("quoting has no publication state and leaves the offer and policy unchanged", () => {
  const supplied = offer(), terms = { ...policy };
  const before = structuredClone({ supplied, terms });

  expect(quoteSiteEnergy(supplied, terms)).toEqual(quoteSiteEnergy(supplied, terms));
  expect({ supplied, terms }).toEqual(before);
});
