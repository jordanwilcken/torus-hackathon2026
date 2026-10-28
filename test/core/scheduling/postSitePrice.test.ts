import { expect, test } from "vitest";
import { postSitePrice } from "../../../src/core/scheduling/postSitePrice.js";
import type { PricedEnergySource, SitePriceInput, SitePriceResult } from "../../../src/core/scheduling/SitePrice.type.js";

function grid(deliveredKWh: number): PricedEnergySource {
  return {
    source: "PACE supplied grid forecast", deliveredKWh, supplyKWh: deliveredKWh,
    usdPerMWh: 50, gramsCO2PerKWh: 400,
    gridDemand: { demandMW: 120, averageDemandMW: 100 },
  };
}

function input(): SitePriceInput {
  return {
    snapshot: {
      status: "current", source: "scenario site ledger", version: "capacity-1",
      observedAt: "2026-10-27T12:00:00Z", projected: false, simulated: true,
      slot: {
        id: "A-12", locationId: "A",
        window: { startAt: "2026-10-27T12:00:00Z", endAt: "2026-10-27T13:00:00Z" },
        availablePowerKW: 4, availableEnergyKWh: 4, capGpus: 4, usedGpus: 0,
        postedUsdPerGpuHour: 999, priceBasis: "old rate",
      },
    },
    forecast: {
      carbon: {
        source: "supplied regional forecast", scope: "PACE", basis: "average operational CO2",
        unit: "gCO2/kWh", retrievedAt: "2026-10-27T12:00:00Z", simulated: true,
        points: [{ window: { startAt: "2026-10-27T12:00:00Z", endAt: "2026-10-27T13:00:00Z" }, value: 400 }],
      },
    },
    profile: { kWhPerGpuHour: 1, activePowerKWPerGpu: 1 },
    carbonPriceUsdPerTonne: 100,
    assessment: {
      slot: { locationId: "A", slotId: "A-12" }, slotVersion: "capacity-1",
      remainingGpuHours: 4, source: "supplied dispatch assessment",
      carbonBasis: "average operational CO2", sources: [grid(4)],
    },
  };
}

function posted(result: SitePriceResult) {
  expect(result.status, result.status === "unavailable" ? result.reason : "").toBe("posted");
  if (result.status !== "posted") throw new Error(result.reason);
  return result;
}

test("regional grid pricing scales energy by demand and adds the modeled carbon charge", () => {
  const result = posted(postSitePrice(input()));

  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.10, 12);
  expect(result.estimate).toMatchObject({ remainingGpus: 4, remainingGpuHours: 4, requiredPowerKW: 4 });
  expect(result.estimate.electricityUsd).toBeCloseTo(0.24, 12);
  expect(result.estimate.carbonKg).toBeCloseTo(1.6, 12);
  expect(result.estimate.carbonChargeUsd).toBeCloseTo(0.16, 12);
});

test("one solar GPU-hour cannot price all four remaining GPU-hours as solar", () => {
  const request = input();
  request.assessment!.sources = [
    { source: "local solar", deliveredKWh: 1, supplyKWh: 1, usdPerMWh: 0, gramsCO2PerKWh: 0 },
    grid(3),
  ];

  const result = posted(postSitePrice(request));

  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.075, 12);
  expect(result.estimate.energy.estimatedKWh).toBe(4);
  expect(result.estimate.carbonKg).toBeCloseTo(1.2, 12);
});

test("a one-GPU assessment cannot stand in for the full four-GPU quantity", () => {
  const request = input();
  request.assessment!.remainingGpuHours = 1;
  request.assessment!.sources = [grid(1)];

  expect(postSitePrice(request)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("quantity") });
});

test("storage losses retain their supplied acquisition cost, carbon and source", () => {
  const request = input();
  request.assessment!.sources = [{
    source: "stored PACE grid energy, charge revision 7, discharge efficiency 0.8",
    deliveredKWh: 4, supplyKWh: 5, usdPerMWh: 50, gramsCO2PerKWh: 400,
  }];

  const result = posted(postSitePrice(request));

  expect(result.estimate.electricityUsd).toBeCloseTo(0.25, 12);
  expect(result.estimate.carbonKg).toBe(2);
  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.1125, 12);
  expect(result.assessment.sources[0].source).toContain("charge revision 7");
});

test("a quarter-hour slot lowers energy and GPU-hours while preserving active power", () => {
  const request = input();
  request.snapshot.slot!.window.endAt = "2026-10-27T12:15:00Z";
  request.snapshot.slot!.capGpus = 1;
  request.snapshot.slot!.availablePowerKW = 0.85;
  request.snapshot.slot!.availableEnergyKWh = 0.2125;
  request.profile = { kWhPerGpuHour: 0.85, activePowerKWPerGpu: 0.85 };
  request.assessment!.remainingGpuHours = 0.25;
  request.assessment!.sources = [grid(0.2125)];

  const result = posted(postSitePrice(request));

  expect(result.estimate.requiredPowerKW).toBe(0.85);
  expect(result.estimate.remainingGpuHours).toBe(0.25);
  expect(result.estimate.energy.estimatedKWh).toBe(0.2125);
  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.085, 12);
});

test("a quarter-hour's energy cannot bypass an insufficient active power limit", () => {
  const request = input();
  request.snapshot.slot!.window.endAt = "2026-10-27T12:15:00Z";
  request.snapshot.slot!.capGpus = 1;
  request.snapshot.slot!.availablePowerKW = 0.25;
  request.snapshot.slot!.availableEnergyKWh = 0.25;

  expect(postSitePrice(request)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("capacity") });
});

test("protected or sold-out supply never publishes a free available slot", () => {
  const protectedInput = input();
  protectedInput.snapshot.slot!.availableEnergyKWh = 0;
  protectedInput.snapshot.siteEnergy = { storedKWh: 4, protectedKWh: 4 };
  expect(postSitePrice(protectedInput).status).toBe("unavailable");

  const soldOut = input();
  soldOut.snapshot.slot!.usedGpus = 4;
  expect(postSitePrice(soldOut).status).toBe("unavailable");
  expect(soldOut.snapshot.slot).toMatchObject({ capGpus: 4, usedGpus: 4 });
});

test("pricing preserves source, freshness, conditional projections and complete forecast evidence", () => {
  const request = input();
  request.snapshot.projected = true;
  const result = posted(postSitePrice(request));

  expect(result.snapshot).toMatchObject({
    status: "current", source: "scenario site ledger", observedAt: "2026-10-27T12:00:00Z",
    projected: true, simulated: true,
  });
  expect(result.forecast).toEqual(request.forecast);
  expect(result.snapshot.version).toBe("capacity-1");
  expect(result.snapshot.slot!.priceBasis).toContain("average operational CO2");
  expect(result.snapshot.slot!.priceBasis).toContain("modeled");
});

test("stale and unavailable local evidence cannot receive a current quote", () => {
  for (const status of ["stale", "unavailable"] as const) {
    const request = input();
    request.snapshot.status = status;
    const result = postSitePrice(request);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.sourceSnapshot.status).toBe(status);
  }
});

test("missing costs or carbon remain unknown even when the carbon price is zero", () => {
  const missingCost = input();
  delete missingCost.assessment!.sources[0].usdPerMWh;
  expect(postSitePrice(missingCost).status).toBe("unavailable");

  const missingCarbon = input();
  delete missingCarbon.assessment!.sources[0].gramsCO2PerKWh;
  missingCarbon.carbonPriceUsdPerTonne = 0;
  expect(postSitePrice(missingCarbon).status).toBe("unavailable");
});

test("slot identity, capacity version and delivered quantity bind the assessment", () => {
  const examples = [
    (request: SitePriceInput) => { request.assessment!.slot.locationId = "B"; },
    (request: SitePriceInput) => { request.assessment!.slot.slotId = "A-13"; },
    (request: SitePriceInput) => { request.assessment!.slotVersion = "capacity-old"; },
    (request: SitePriceInput) => { request.assessment!.sources = [grid(1)]; },
  ];
  for (const change of examples) {
    const request = input();
    change(request);
    expect(postSitePrice(request).status).toBe("unavailable");
  }
});

test("pricing reads supplied values and owns independent snapshots without reservations", () => {
  const request = input();
  const before = structuredClone(request);
  const result = posted(postSitePrice(request));

  expect(request).toEqual(before);
  expect(result.snapshot.slot!.usedGpus).toBe(0);
  result.snapshot.slot!.usedGpus = 3;
  result.forecast.carbon!.points[0].value = 999;
  result.assessment.sources[0].supplyKWh = 999;
  expect(request).toEqual(before);
});

test("power and energy constrain published GPUs while already used GPUs remain reserved", () => {
  const request = input();
  request.snapshot.slot!.capGpus = 8;
  request.snapshot.slot!.usedGpus = 2;
  request.snapshot.slot!.availablePowerKW = 3;
  request.snapshot.slot!.availableEnergyKWh = 2.5;
  request.assessment!.remainingGpuHours = 2.5;
  request.assessment!.sources = [grid(2.5)];

  const result = posted(postSitePrice(request));

  expect(result.snapshot.slot).toMatchObject({
    capGpus: 5, usedGpus: 2, availablePowerKW: 3, availableEnergyKWh: 2.5,
  });
  expect(result.estimate.remainingGpus).toBe(3);
  expect(result.estimate.remainingGpuHours).toBe(2.5);
  expect(request.snapshot.slot).toMatchObject({ capGpus: 8, usedGpus: 2 });
});

test("a reservation requires a new full-quantity assessment and refreshes the published version", () => {
  const request = input();
  request.assessment!.sources = [
    { source: "solar", deliveredKWh: 1, supplyKWh: 1, usdPerMWh: 0, gramsCO2PerKWh: 0 },
    grid(3),
  ];
  const before = posted(postSitePrice(request));
  request.snapshot.slot!.usedGpus = 1;
  request.snapshot.slot!.availablePowerKW = 3;
  request.snapshot.slot!.availableEnergyKWh = 3;
  request.snapshot.version = "capacity-2";
  expect(postSitePrice(request).status).toBe("unavailable");

  request.assessment!.slotVersion = "capacity-2";
  request.assessment!.remainingGpuHours = 3;
  request.assessment!.sources = [grid(3)];
  const after = posted(postSitePrice(request));

  expect(before.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.075, 12);
  expect(after.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.10, 12);
  expect(after.snapshot.version).not.toBe(before.snapshot.version);
  expect(after.snapshot.slot?.usedGpus).toBe(1);
});

test("a new supplied version retains a change in carbon-price assumptions", () => {
  const request = input();
  const before = posted(postSitePrice(request));
  request.carbonPriceUsdPerTonne = 0;
  request.snapshot.version = "capacity-1-terms-2";
  request.assessment!.slotVersion = "capacity-1-terms-2";
  const after = posted(postSitePrice(request));

  expect(after.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.06, 12);
  expect(after.snapshot.version).toBe("capacity-1-terms-2");
  expect(after.snapshot.version).not.toBe(before.snapshot.version);
});

test("known zero-cost zero-carbon solar can publish an actual zero rate", () => {
  const request = input();
  request.assessment!.sources = [{
    source: "solar", deliveredKWh: 4, supplyKWh: 4, usdPerMWh: 0, gramsCO2PerKWh: 0,
  }];
  const result = posted(postSitePrice(request));

  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBe(0);
  expect(result.estimate.remainingGpus).toBe(4);
});

test("ordinary binary64 rounding does not drop the third GPU at 0.1 kW each", () => {
  const request = input();
  request.snapshot.slot!.capGpus = 3;
  request.snapshot.slot!.availablePowerKW = 0.3;
  request.snapshot.slot!.availableEnergyKWh = 0.3;
  request.profile = { kWhPerGpuHour: 0.1, activePowerKWPerGpu: 0.1 };
  request.assessment!.remainingGpuHours = 3;
  request.assessment!.sources = [grid(0.3)];

  const result = posted(postSitePrice(request));

  expect(result.estimate.remainingGpus).toBe(3);
  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.01, 12);
  expect(result.snapshot.slot?.availablePowerKW).toBe(0.3);
});

test("invalid rates, quantities, profiles and slot windows cannot create a numeric quote", () => {
  const examples = [
    (request: SitePriceInput) => { request.profile.activePowerKWPerGpu = 0; },
    (request: SitePriceInput) => { request.profile.kWhPerGpuHour = Number.NaN; },
    (request: SitePriceInput) => { request.carbonPriceUsdPerTonne = -1; },
    (request: SitePriceInput) => { request.assessment!.sources[0].usdPerMWh = Number.POSITIVE_INFINITY; },
    (request: SitePriceInput) => { request.assessment!.sources[0].gridDemand!.averageDemandMW = 0; },
    (request: SitePriceInput) => { request.assessment!.sources[0].supplyKWh = 3; },
    (request: SitePriceInput) => { request.snapshot.slot!.usedGpus = 5; },
    (request: SitePriceInput) => { request.snapshot.slot!.capGpus = 1.5; },
    (request: SitePriceInput) => { request.snapshot.slot!.window.endAt = request.snapshot.slot!.window.startAt; },
  ];
  for (const change of examples) {
    const request = input();
    change(request);
    expect(() => postSitePrice(request)).toThrow(RangeError);
  }
});

test("a full-hour slot can supply fractional final work at full active power", () => {
  const request = input();
  request.snapshot.slot!.capGpus = 1;
  request.snapshot.slot!.availablePowerKW = 1;
  request.snapshot.slot!.availableEnergyKWh = 0.25;
  request.assessment!.remainingGpuHours = 0.25;
  request.assessment!.sources = [grid(0.25)];

  const result = posted(postSitePrice(request));

  expect(result.estimate.remainingGpuHours).toBe(0.25);
  expect(result.estimate.requiredPowerKW).toBe(1);
  expect(result.snapshot.slot).toMatchObject({ capGpus: 1, availablePowerKW: 1, availableEnergyKWh: 0.25 });
  expect(result.snapshot.slot?.postedUsdPerGpuHour).toBeCloseTo(0.10, 12);
});

test("overflowed source quantities cannot pass the full-quantity check as free energy", () => {
  const request = input();
  request.assessment!.sources = [
    { source: "solar A", deliveredKWh: 1e308, supplyKWh: 1e308, usdPerMWh: 0, gramsCO2PerKWh: 0 },
    { source: "solar B", deliveredKWh: 1e308, supplyKWh: 1e308, usdPerMWh: 0, gramsCO2PerKWh: 0 },
  ];

  expect(postSitePrice(request).status).toBe("unavailable");
});
