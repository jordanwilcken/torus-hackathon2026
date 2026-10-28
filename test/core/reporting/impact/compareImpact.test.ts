import { expect, test } from "vitest";
import { compareImpact, carbonReductionKg, modeledCostReductionUsd } from "../../../../src/core/reporting/impact/compareImpact.js";
import type { ImpactObservation } from "../../../../src/core/reporting/ImpactObservation.interface.js";
import type { JobObservations } from "../../../../src/core/reporting/JobObservations.type.js";

function observation(arm: ImpactObservation["arm"], changes: Partial<ImpactObservation> = {}): ImpactObservation {
  return {
    comparisonId: "comparison-1",
    inputRevision: "inputs-1",
    arm,
    jobId: "training",
    horizon: { startAt: "2026-10-27T18:00:00Z", endAt: "2026-10-27T19:00:00Z" },
    accountingBasis: "average operational CO2 including transfers",
    source: "simulated fleet meters",
    simulated: true,
    feasible: true,
    carbonKg: arm === "baseline" ? 0.4 : 0,
    electricityUsd: arm === "baseline" ? 0.05 : 0,
    modeledCostUsd: arm === "baseline" ? 0.09 : 0,
    costBasis: "electricity plus CO2 at USD 100 per tonne",
    work: [{ jobId: "training", requiredGpuH: 1, completedGpuH: 1 }],
    inventory: [{ locationId: "A", initialStoredKWh: 1, endingStoredKWh: 1,
      initialStoredCarbonKg: 0.4, endingStoredCarbonKg: 0.4,
      initialStoredElectricityUsd: 0.05, endingStoredElectricityUsd: 0.05 }],
    storageToleranceKWh: 0.01,
    ...changes,
  };
}

function compare(selected: Partial<ImpactObservation> = {}, baseline: Partial<ImpactObservation> = {}) {
  return compareImpact({
    jobId: "training",
    baseline: observation("baseline", baseline),
    selected: observation("selected", selected),
  });
}

test("equal completed work and storage allow carbon and modeled cost reductions from the supplied totals", () => {
  const report = compare();

  expect(report.comparison).toBe("comparable");
  expect(report.carbon).toMatchObject({ baselineCarbonKg: 0.4, selectedCarbonKg: 0 });
  expect(carbonReductionKg(report.carbon)).toBeCloseTo(0.4, 9);
  expect(report.cost).toMatchObject({
    baselineModeledCostUsd: 0.09, selectedModeledCostUsd: 0,
    baselineElectricityUsd: 0.05, selectedElectricityUsd: 0,
  });
  expect(modeledCostReductionUsd(report.cost)).toBeCloseTo(0.09, 9);
  expect(report.carbon.unavailableReason).toBeUndefined();
  expect(report.cost.unavailableReason).toBeUndefined();
});

test("higher selected carbon and cost remain negative reductions", () => {
  const report = compare({ carbonKg: 0.6, modeledCostUsd: 0.12, electricityUsd: 0.06 });

  expect(report.comparison).toBe("comparable");
  expect(carbonReductionKg(report.carbon)).toBeCloseTo(-0.2, 9);
  expect(modeledCostReductionUsd(report.cost)).toBeCloseTo(-0.03, 9);
});

test('unknown nonempty stored inventory cannot support savings, while empty storage needs no burden estimate', () => {
  const unknown = compare({ inventory: [{ locationId: 'A', initialStoredKWh: 1, endingStoredKWh: 1 }] });
  expect(carbonReductionKg(unknown.carbon)).toBeUndefined();
  expect(modeledCostReductionUsd(unknown.cost)).toBeUndefined();
  const empty = { inventory: [{ locationId: 'A', initialStoredKWh: 0, endingStoredKWh: 0 }] };
  expect(carbonReductionKg(compare(empty, empty).carbon)).toBeCloseTo(0.4);
});

test('stored cost evidence is independent of carbon and carbon-free cost policies need no stored carbon attribution', () => {
  const inventory = { ...observation('selected').inventory[0], endingStoredElectricityUsd: undefined };
  const report = compare({ inventory: [inventory] });
  expect(carbonReductionKg(report.carbon)).toBeCloseTo(0.4);
  expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
  const carbonUnknown = { ...observation('selected').inventory[0], endingStoredCarbonKg: undefined };
  const policy = { carbonPriceUsdPerTonne: 0, costBasis: 'Electricity only' };
  const electricityOnly = compare({ ...policy, inventory: [carbonUnknown], modeledCostUsd: 0 }, { ...policy, modeledCostUsd: 0.05 });
  expect(carbonReductionKg(electricityOnly.carbon)).toBeUndefined();
  expect(modeledCostReductionUsd(electricityOnly.cost)).toBeCloseTo(0.05);
});

test("missing observations and totals remain unknown independently of the other measure", () => {
  let report = compareImpact({ jobId: "training" });
  expect(report.comparison).toBe("unavailable");
  expect(carbonReductionKg(report.carbon)).toBeUndefined();
  expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
  expect(report.carbon.unavailableReason).toBe("Execution measurements have not been observed.");

  report = compareImpact({ jobId: "training", baseline: observation("baseline") });
  expect(report.carbon.baselineCarbonKg).toBe(0.4);
  expect(report.carbon.selectedCarbonKg).toBeUndefined();
  expect(report.comparison).toBe("unavailable");
  expect(report.carbon.unavailableReason).toBe("Both comparison arms are required.");

  report = compare({ carbonKg: null });
  expect(report.comparison).toBe("comparable");
  expect(report.carbon.selectedCarbonKg).toBeUndefined();
  expect(carbonReductionKg(report.carbon)).toBeUndefined();
  expect(report.carbon.unavailableReason).toBeTruthy();
  expect(modeledCostReductionUsd(report.cost)).toBeCloseTo(0.09, 9);

  report = compare({ modeledCostUsd: null, electricityUsd: undefined });
  expect(carbonReductionKg(report.carbon)).toBeCloseTo(0.4, 9);
  expect(report.cost.selectedModeledCostUsd).toBeUndefined();
  expect(report.cost.selectedElectricityUsd).toBeUndefined();
  expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
  expect(report.cost.unavailableReason).toBeTruthy();
});

test("different comparisons, input revisions and horizons cannot establish a reduction", () => {
  const incompatible: { reason: string; selected: Partial<ImpactObservation> }[] = [
    { reason: "another comparison", selected: { comparisonId: "comparison-2" } },
    { reason: "another input revision", selected: { inputRevision: "inputs-2" } },
    { reason: "another horizon", selected: {
      horizon: { startAt: "2026-10-27T18:00:00Z", endAt: "2026-10-27T20:00:00Z" },
    } },
  ];
  for (const example of incompatible) {
    const report = compare(example.selected);
    expect(report.comparison, example.reason).toBe("not-comparable");
    expect(carbonReductionKg(report.carbon), example.reason).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost), example.reason).toBeUndefined();
  }
});

test("incompatible carbon bases, mixed simulation evidence and infeasible runs prevent comparison", () => {
  const incompatible: { reason: string; selected: Partial<ImpactObservation> }[] = [
    { reason: "marginal versus average carbon", selected: { accountingBasis: "marginal operational CO2" } },
    { reason: "measured versus simulated evidence", selected: { simulated: false } },
    { reason: "physically infeasible execution", selected: { feasible: false } },
  ];
  for (const example of incompatible) {
    const report = compare(example.selected);
    expect(report.comparison, example.reason).toBe("not-comparable");
    expect(carbonReductionKg(report.carbon), example.reason).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost), example.reason).toBeUndefined();
  }
});

test("the work cohort must be nonempty, unique, matching and fully completed", () => {
  const incompatible: { reason: string; work: ImpactObservation["work"] }[] = [
    { reason: "no work evidence", work: [] },
    { reason: "duplicate job evidence", work: [
      { jobId: "training", requiredGpuH: 1, completedGpuH: 1 },
      { jobId: "training", requiredGpuH: 1, completedGpuH: 1 },
    ] },
    { reason: "a different job", work: [{ jobId: "other-job", requiredGpuH: 1, completedGpuH: 1 }] },
    { reason: "a different amount of work", work: [{ jobId: "training", requiredGpuH: 2, completedGpuH: 2 }] },
    { reason: "unfinished work", work: [{ jobId: "training", requiredGpuH: 1, completedGpuH: 0.5 }] },
  ];
  for (const example of incompatible) {
    const report = compare({ work: example.work });
    expect(report.comparison, example.reason).toBe("not-comparable");
    expect(carbonReductionKg(report.carbon), example.reason).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost), example.reason).toBeUndefined();
  }
});

test("site inventories must be nonempty, unique and start with the same energy at matching sites", () => {
  const incompatible: { reason: string; inventory: ImpactObservation["inventory"] }[] = [
    { reason: "no inventory evidence", inventory: [] },
    { reason: "duplicate site evidence", inventory: [
      { locationId: "A", initialStoredKWh: 1, endingStoredKWh: 1 },
      { locationId: "A", initialStoredKWh: 1, endingStoredKWh: 1 },
    ] },
    { reason: "a different site", inventory: [{ locationId: "B", initialStoredKWh: 1, endingStoredKWh: 1 }] },
    { reason: "more initial stored energy", inventory: [{ locationId: "A", initialStoredKWh: 2, endingStoredKWh: 1 }] },
  ];
  for (const example of incompatible) {
    const report = compare({ inventory: example.inventory });
    expect(report.comparison, example.reason).toBe("not-comparable");
    expect(carbonReductionKg(report.carbon), example.reason).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost), example.reason).toBeUndefined();
  }
});

test("ending storage must match within the declared energy tolerance", () => {
  const withinTolerance = compare({
    inventory: [{ ...observation('selected').inventory[0], endingStoredKWh: 0.995 }],
  });
  expect(withinTolerance.comparison).toBe("comparable");
  expect(carbonReductionKg(withinTolerance.carbon)).toBeCloseTo(0.4, 9);

  const depletedStorage = compare({
    inventory: [{ locationId: "A", initialStoredKWh: 1, endingStoredKWh: 0.98 }],
  });
  expect(depletedStorage.comparison).toBe("not-comparable");
  expect(carbonReductionKg(depletedStorage.carbon)).toBeUndefined();
  expect(modeledCostReductionUsd(depletedStorage.cost)).toBeUndefined();
});

test("a different cost policy withholds cost reduction while comparable carbon remains available", () => {
  const report = compare({ costBasis: "electricity plus CO2 at USD 200 per tonne" });

  expect(report.comparison).toBe("comparable");
  expect(carbonReductionKg(report.carbon)).toBeCloseTo(0.4, 9);
  expect(report.cost).toMatchObject({ baselineModeledCostUsd: 0.09, selectedModeledCostUsd: 0 });
  expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
  expect(report.cost.unavailableReason).toBeTruthy();
});

test("comparison leaves its inputs unchanged and returns independent report values", () => {
  const observations = {
    jobId: "training", baseline: observation("baseline"), selected: observation("selected"),
  };
  const before = structuredClone(observations);
  const report = compareImpact(observations);
  expect(observations).toEqual(before);

  report.carbon.baselineCarbonKg = 100;
  report.cost.baselineModeledCostUsd = 100;
  const freshReport = compareImpact(observations);
  expect(freshReport.carbon).toMatchObject({ baselineCarbonKg: 0.4, selectedCarbonKg: 0 });
  expect(freshReport.cost).toMatchObject({ baselineModeledCostUsd: 0.09, selectedModeledCostUsd: 0 });

  observations.selected.carbonKg = 100;
  observations.selected.modeledCostUsd = 100;
  expect(freshReport.carbon.selectedCarbonKg).toBe(0);
  expect(freshReport.cost.selectedModeledCostUsd).toBe(0);
});

test("invalid numeric evidence cannot establish a physical comparison or a known measure", () => {
  const invalidPhysicalEvidence: Partial<ImpactObservation>[] = [
    { work: [{ jobId: "training", requiredGpuH: -1, completedGpuH: -1 }] },
    { work: [{ jobId: "training", requiredGpuH: 1, completedGpuH: Number.NaN }] },
    { inventory: [{ locationId: "A", initialStoredKWh: 1, endingStoredKWh: -1 }] },
    { inventory: [{ locationId: "A", initialStoredKWh: Infinity, endingStoredKWh: 1 }] },
    { storageToleranceKWh: -1 },
    { storageToleranceKWh: Infinity },
  ];
  for (const invalid of invalidPhysicalEvidence) {
    const report = compare(invalid, invalid);
    expect(report.comparison).toBe("not-comparable");
    expect(carbonReductionKg(report.carbon)).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
  }

  for (const carbonKg of [-1, Number.NaN, Infinity]) {
    const report = compare({ carbonKg });
    expect(report.comparison).toBe("comparable");
    expect(report.carbon.selectedCarbonKg).toBeUndefined();
    expect(carbonReductionKg(report.carbon)).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost)).toBeCloseTo(0.09, 9);
  }
  for (const modeledCostUsd of [Number.NaN, Infinity]) {
    const report = compare({ modeledCostUsd });
    expect(report.comparison).toBe("comparable");
    expect(report.cost.selectedModeledCostUsd).toBeUndefined();
    expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
    expect(carbonReductionKg(report.carbon)).toBeCloseTo(0.4, 9);
  }

  const overflow = compare(
    { modeledCostUsd: -Number.MAX_VALUE },
    { modeledCostUsd: Number.MAX_VALUE },
  );
  expect(overflow.comparison).toBe("comparable");
  expect(modeledCostReductionUsd(overflow.cost)).toBeUndefined();
});

test("a new input revision withholds reductions until both arm snapshots match again", () => {
  const observations: JobObservations = {
    jobId: "training", baseline: observation("baseline"), selected: observation("selected"),
  };
  expect(carbonReductionKg(compareImpact(observations).carbon)).toBeCloseTo(0.4, 9);

  observations.selected = observation("selected", {
    inputRevision: "inputs-2", carbonKg: 0.2, modeledCostUsd: 0.04, electricityUsd: 0.02,
  });
  const mismatched = compareImpact(observations);
  expect(mismatched.comparison).toBe("not-comparable");
  expect(carbonReductionKg(mismatched.carbon)).toBeUndefined();
  expect(modeledCostReductionUsd(mismatched.cost)).toBeUndefined();

  observations.baseline = observation("baseline", {
    inputRevision: "inputs-2", carbonKg: 0.5, modeledCostUsd: 0.12, electricityUsd: 0.07,
  });
  const matched = compareImpact(observations);
  expect(matched.comparison).toBe("comparable");
  expect(matched.carbon).toMatchObject({ baselineCarbonKg: 0.5, selectedCarbonKg: 0.2 });
  expect(carbonReductionKg(matched.carbon)).toBeCloseTo(0.3, 9);
  expect(matched.cost).toMatchObject({ baselineModeledCostUsd: 0.12, selectedModeledCostUsd: 0.04 });
  expect(modeledCostReductionUsd(matched.cost)).toBeCloseTo(0.08, 9);
});
