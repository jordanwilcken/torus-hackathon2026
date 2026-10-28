import { expect, test } from "vitest";
import { postSitePrice } from "../../../src/core/scheduling/postSitePrice.js";
import type { PricedEnergySource, SitePriceInput, SitePriceResult } from "../../../src/core/scheduling/SitePrice.type.js";

function grid(deliveredKWh: number): PricedEnergySource {
  return {
    deliveredKWh, supplyKWh: deliveredKWh, usdPerMWh: 50, gramsCO2PerKWh: 400,
    gridDemand: { demandMW: 120, averageDemandMW: 100 },
  };
}

function input(): SitePriceInput {
  return { remainingGpuHours: 4, requiredEnergyKWh: 4, sources: [grid(4)], carbonPriceUsdPerTonne: 100 };
}

function posted(result: SitePriceResult) {
  expect(result.status, result.status === "unavailable" ? result.reason : "").toBe("posted");
  if (result.status !== "posted") throw new Error(result.reason);
  return result;
}

test("regional grid pricing scales energy by demand and adds the modeled carbon charge", () => {
  const result = posted(postSitePrice(input()));

  expect(result.postedUsdPerGpuHour).toBeCloseTo(0.10, 12);
  expect(result.electricityUsd).toBeCloseTo(0.24, 12);
  expect(result.carbonKg).toBeCloseTo(1.6, 12);
  expect(result.carbonChargeUsd).toBeCloseTo(0.16, 12);
});

test("one solar GPU-hour cannot price all four remaining GPU-hours as solar", () => {
  const result = posted(postSitePrice({ ...input(), sources: [
    { deliveredKWh: 1, supplyKWh: 1, usdPerMWh: 0, gramsCO2PerKWh: 0 }, grid(3),
  ] }));

  expect(result.postedUsdPerGpuHour).toBeCloseTo(0.075, 12);
  expect(result.electricityUsd).toBeCloseTo(0.18, 12);
  expect(result.carbonKg).toBeCloseTo(1.2, 12);
});

test("one GPU-hour's energy cannot stand in for the full four-GPU quantity", () => {
  expect(postSitePrice({ ...input(), sources: [grid(1)] })).toMatchObject({
    status: "unavailable", reason: expect.stringContaining("quantity"),
  });
});

test("storage losses retain their supplied acquisition cost and carbon burden", () => {
  const result = posted(postSitePrice({ ...input(), sources: [{
    deliveredKWh: 4, supplyKWh: 5, usdPerMWh: 50, gramsCO2PerKWh: 400,
  }] }));

  expect(result.electricityUsd).toBeCloseTo(0.25, 12);
  expect(result.carbonKg).toBe(2);
  expect(result.postedUsdPerGpuHour).toBeCloseTo(0.1125, 12);
});

test("a fractional GPU-hour uses its assessed energy without needing timestamp parsing", () => {
  const result = posted(postSitePrice({
    remainingGpuHours: 0.25, requiredEnergyKWh: 0.2125,
    sources: [grid(0.2125)], carbonPriceUsdPerTonne: 100,
  }));

  expect(result.postedUsdPerGpuHour).toBeCloseTo(0.085, 12);
  expect(result.electricityUsd).toBeCloseTo(0.01275, 12);
  expect(result.carbonKg).toBeCloseTo(0.085, 12);
});

test("zero remaining work or usable energy leaves the price unavailable", () => {
  expect(postSitePrice({ ...input(), remainingGpuHours: 0 }).status).toBe("unavailable");
  expect(postSitePrice({ ...input(), requiredEnergyKWh: 0, sources: [] }).status).toBe("unavailable");
});

test("missing costs or carbon remain unknown even when the carbon price is zero", () => {
  const { usdPerMWh, ...missingCost } = grid(4);
  expect(postSitePrice({ ...input(), sources: [missingCost] }).status).toBe("unavailable");

  const { gramsCO2PerKWh, ...missingCarbon } = grid(4);
  expect(postSitePrice({ ...input(), sources: [missingCarbon], carbonPriceUsdPerTonne: 0 }).status).toBe("unavailable");
});

test("pricing leaves the assessed input unchanged and makes no reservation", () => {
  const request = input();
  const before = structuredClone(request);

  const first = posted(postSitePrice(request));
  const second = posted(postSitePrice(request));

  expect(request).toEqual(before);
  expect(second).toEqual(first);
});

test("changed remaining capacity needs a matching full energy mix and a new price", () => {
  const before = posted(postSitePrice({ ...input(), sources: [
    { deliveredKWh: 1, supplyKWh: 1, usdPerMWh: 0, gramsCO2PerKWh: 0 }, grid(3),
  ] }));
  const remaining = { ...input(), remainingGpuHours: 3, requiredEnergyKWh: 3 };
  expect(postSitePrice(remaining).status).toBe("unavailable");
  const after = posted(postSitePrice({ ...remaining, sources: [grid(3)] }));

  expect(before.postedUsdPerGpuHour).toBeCloseTo(0.075, 12);
  expect(after.postedUsdPerGpuHour).toBeCloseTo(0.10, 12);
});

test("removing the carbon charge reprices the same assessed energy", () => {
  const result = posted(postSitePrice({ ...input(), carbonPriceUsdPerTonne: 0 }));

  expect(result.postedUsdPerGpuHour).toBeCloseTo(0.06, 12);
  expect(result.carbonKg).toBeCloseTo(1.6, 12);
  expect(result.carbonChargeUsd).toBe(0);
});

test("known zero-cost zero-carbon solar can publish an actual zero rate", () => {
  const result = posted(postSitePrice({ ...input(), sources: [{
    deliveredKWh: 4, supplyKWh: 4, usdPerMWh: 0, gramsCO2PerKWh: 0,
  }] }));

  expect(result.postedUsdPerGpuHour).toBe(0);
});

test("a fractional final quantity keeps its per-GPU-hour price", () => {
  const result = posted(postSitePrice({ ...input(),
    remainingGpuHours: 0.25, requiredEnergyKWh: 0.25, sources: [grid(0.25)],
  }));

  expect(result.postedUsdPerGpuHour).toBeCloseTo(0.10, 12);
  expect(result.electricityUsd).toBeCloseTo(0.015, 12);
  expect(result.carbonKg).toBeCloseTo(0.10, 12);
});

test("overflowed source quantities cannot pass the full-quantity check as free energy", () => {
  const source = { deliveredKWh: 1e308, supplyKWh: 1e308, usdPerMWh: 0, gramsCO2PerKWh: 0 };
  expect(postSitePrice({ ...input(), sources: [source, source] }).status).toBe("unavailable");
});

test("very large finite delivered energy cannot match a four-kWh requirement", () => {
  expect(postSitePrice({ ...input(), sources: [{
    deliveredKWh: 1e308, supplyKWh: 1e308, usdPerMWh: 0, gramsCO2PerKWh: 0,
  }] }).status).toBe("unavailable");
});

test("computed cost overflow remains unavailable for otherwise finite supplied numbers", () => {
  expect(postSitePrice({ ...input(), sources: [{
    deliveredKWh: 4, supplyKWh: 1e308, usdPerMWh: 1e308, gramsCO2PerKWh: 0,
  }] }).status).toBe("unavailable");
});
