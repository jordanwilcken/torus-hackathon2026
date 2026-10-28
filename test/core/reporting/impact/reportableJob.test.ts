import { expect, test, vi } from "vitest";
import { getFakeJob } from "../../../../src/core/jobs/fakes/getFakeJob.js";
import { routeFakeJob } from "../../../../src/core/scheduling/fakes/fakeRouter.js";
import { reportableJob, withReporting } from "../../../../src/core/reporting/impact/reportableJob.js";
import { createJobReport } from "../../../../src/core/reporting/getJobReport.js";
import type { ImpactObservation } from "../../../../src/core/reporting/ImpactObservation.interface.js";

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
    inventory: [{ locationId: "A", initialStoredKWh: 1, endingStoredKWh: 1 }],
    storageToleranceKWh: 0.01,
    ...changes,
  };
}


test("records the Fake job and selection; reading a report supplies no execution totals", async () => {
  const job = getFakeJob();
  const observer = reportableJob(job.id);
  const outcome = await withReporting(routeFakeJob, observer)(job);
  const observed = observer.readObservations();

  expect(outcome.selected).toBe(true);
  expect(observed.submittedJob).toEqual(job);
  expect(observed.routingOutcome).toEqual(outcome);
  expect(observed.baseline).toBeUndefined();
  expect(observed.selected).toBeUndefined();
  expect(observed.routingOutcome?.selected && observed.routingOutcome.allocation.forecast.carbon?.source).toBe("fake-regional-carbon");

  const report = createJobReport(observed, { fake: true, label: "Observed Fake job flow" });
  expect(report.fake).toBe(true);
  expect(report.comparison).toBe("unavailable");
  expect(report.carbon.baselineCarbonKg).toBeUndefined();
  expect(report.carbon.selectedCarbonKg).toBeUndefined();
  expect(report.cost.baselineModeledCostUsd).toBeUndefined();
  expect(report.cost.selectedModeledCostUsd).toBeUndefined();
});

test("submission is observable while routing is pending, then the exact outcome is returned", async () => {
  const job = getFakeJob();
  const observer = reportableJob(job.id);
  const outcome = { selected: false as const, explanation: "No eligible slot." };
  let finishRouting!: (value: typeof outcome) => void;
  const routing = new Promise<typeof outcome>(resolve => { finishRouting = resolve; });
  const routeJob = withReporting(async submitted => {
    expect(submitted).toBe(job);
    return routing;
  }, observer);

  const pending = routeJob(job);
  expect(observer.readObservations().submittedJob).toEqual(job);
  expect(observer.readObservations().routingOutcome).toBeUndefined();

  finishRouting(outcome);
  expect(await pending).toBe(outcome);
  expect(observer.readObservations().routingOutcome).toEqual(outcome);
});

test("routing failure records the error and clears the earlier selection without replacing the error", async () => {
  const job = getFakeJob();
  const observer = reportableJob(job.id);
  await withReporting(routeFakeJob, observer)(job);
  const failure = new Error("");

  await expect(withReporting(async () => { throw failure; }, observer)(job)).rejects.toBe(failure);

  expect(observer.readObservations().submittedJob).toEqual(job);
  expect(observer.readObservations().routingOutcome).toBeUndefined();
  expect(observer.readObservations().routingFailure).toBe("");
});

test("caller mutation cannot change captured jobs, outcomes or comparison evidence", async () => {
  const job = getFakeJob();
  const observer = reportableJob(job.id);
  const outcome = await withReporting(routeFakeJob, observer)(job);
  if (!outcome.selected) throw new Error("Expected the selected Fake fixture.");
  const evidence = observation("baseline", { jobId: job.id });
  observer.observe(evidence);

  job.workGpuH = 99;
  outcome.allocation.postedUsdPerGpuHour = 99;
  evidence.work[0].completedGpuH = 99;
  const snapshot = observer.readObservations();
  snapshot.submittedJob!.workGpuH = 200;
  snapshot.baseline!.carbonKg = 200;
  if (snapshot.routingOutcome?.selected) snapshot.routingOutcome.allocation.slot.locationId = "changed";

  const current = observer.readObservations();
  expect(current.submittedJob?.workGpuH).toBe(1);
  expect(current.routingOutcome?.selected && current.routingOutcome.allocation.postedUsdPerGpuHour).toBe(0);
  expect(current.routingOutcome?.selected && current.routingOutcome.allocation.slot.locationId).toBe("fake-utah-solar");
  expect(current.baseline?.carbonKg).toBe(0.4);
  expect(current.baseline?.work[0].completedGpuH).toBe(1);
});

test("each cumulative observation replaces that side's snapshot without adding totals", () => {
  const observer = reportableJob("training");
  observer.observe(observation("baseline"));
  observer.observe(observation("selected"));
  observer.observe(observation("selected", { carbonKg: 0.2, modeledCostUsd: 0.04 }));

  expect(observer.readObservations().baseline?.carbonKg).toBe(0.4);
  expect(observer.readObservations().selected?.carbonKg).toBe(0.2);
  expect(observer.readObservations().selected?.modeledCostUsd).toBe(0.04);
});

test("a new submission clears the previous attempt and its comparison evidence", async () => {
  const job = { ...getFakeJob(), id: "training" };
  const observer = reportableJob(job.id);
  observer.observe(observation("baseline"));
  observer.observe(observation("selected"));
  observer.observeRoutingFailure(new Error("Previous failure"));

  const pending = withReporting(async () => ({ selected: false as const, explanation: "No slot selected." }), observer)(job);
  expect(observer.readObservations()).toEqual({ jobId: job.id, submittedJob: job });
  await pending;
  expect(createJobReport(observer.readObservations()).comparison).toBe("unavailable");
});

test("observations for another job leave this job's captured facts unchanged", () => {
  const observer = reportableJob("training");
  observer.observe(observation("baseline"));
  const before = observer.readObservations();

  observer.observe(observation("baseline", { jobId: "another-job", carbonKg: 99 }));
  observer.observeJob(getFakeJob());

  expect(observer.readObservations()).toEqual(before);
});

test("routing another job leaves this observer untouched and preserves the outcome", async () => {
  const observer = reportableJob("training");
  const job = getFakeJob();
  const outcome = { selected: false as const, explanation: "No slot selected." };

  expect(await withReporting(async () => outcome, observer)(job)).toBe(outcome);
  expect(observer.readObservations()).toEqual({ jobId: "training" });
});

test("the observer captures supplied evidence without deciding whether it is comparable", () => {
  const observer = reportableJob("training");
  const evidence = observation("selected", { carbonKg: -1, feasible: false, work: [], inventory: [] });

  expect(() => observer.observe(evidence)).not.toThrow();
  expect(observer.readObservations().selected).toEqual(evidence);
});

test("Fake routing resolves without scheduling timers or advancing the clock", async () => {
  vi.useFakeTimers();
  try {
    const outcome = routeFakeJob(getFakeJob());
    expect(vi.getTimerCount()).toBe(0);
    await expect(outcome).resolves.toMatchObject({
      selected: true,
      allocation: { slot: { locationId: "fake-utah-solar" } },
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
