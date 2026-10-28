import { createJobReport } from "../../../../src/core/reporting/getJobReport.js";
import { carbonReductionKg, modeledCostReductionUsd } from "../../../../src/core/reporting/impact/compareImpact.js";
import { expect, test } from "vitest";
import type { Job } from "../../../../src/core/jobs/Job.type.js";
import type { SiteMeter } from "../../../../src/core/execution/SiteMeter.type.js";
import type { ExecutionRun } from "../../../../src/core/reporting/ExecutionEvidence.type.js";
import { summarizeExecution } from "../../../../src/core/reporting/impact/summarizeExecution.js";

const horizon = { startAt: "2026-10-27T12:00:00Z", endAt: "2026-10-27T14:00:00Z" };
const firstHour = { startAt: horizon.startAt, endAt: "2026-10-27T13:00:00Z" };
const secondHour = { startAt: firstHour.endAt, endAt: horizon.endAt };
const accountingBasis = "recorded operational CO2 including storage and transfers";

function job(id: string): Job {
    return {
        id, workloadRef: id, computeProfile: "gpu", window: { ...horizon },
        allowedLocations: ["A", "B"], homeLocation: "A", currentLocation: "A",
        readyAt: horizon.startAt, workGpuH: 1, remainingGpuH: 1,
        maxGpus: 1, dataGB: 1, state: "queued",
    };
}

function meter(locationId: string, window: SiteMeter["window"], changes: Partial<SiteMeter> = {}): SiteMeter {
    return {
        locationId, window, solarKWh: 0, gridImportKWh: 1, batteryChargeKWh: 0,
        batteryDischargeKWh: 0, curtailedKWh: 0, fixedLoadKWh: 1, computeKWh: 0,
        endingStoredKWh: 1, endingStoredCarbonKg: 0.4, endingStoredElectricityUsd: 0.05,
        accountingBasis, carbonKg: 0.4, electricityUsd: 0.05,
        ...changes,
    };
}

function recordedRun(): ExecutionRun {
    return {
        comparisonId: "recorded-fleet", inputRevision: "inputs-1", arm: "baseline", jobId: "training",
        horizon: { ...horizon }, accountingBasis, source: "recorded executor observations",
        simulated: true, storageToleranceKWh: 0.01,
        jobs: [job("training"), job("embeddings")],
        sites: [
            { locationId: "A", initialStoredKWh: 1, initialStoredCarbonKg: 0.4, initialStoredElectricityUsd: 0.05, gridImportLimitKW: 3 },
            { locationId: "B", initialStoredKWh: 1, initialStoredCarbonKg: 0.4, initialStoredElectricityUsd: 0.05, gridImportLimitKW: 1 },
        ],
        ticks: [
            {
                feasible: true,
                executions: [{
                    jobId: "embeddings", locationId: "A", window: firstHour,
                    completedGpuH: 1, remainingGpuH: 0, state: "done", computeKWh: 1, postedChargeUsd: 99,
                }],
                meters: [
                    meter("A", firstHour, { solarKWh: 2, batteryChargeKWh: 1, computeKWh: 1, endingStoredKWh: 2 }),
                    meter("B", firstHour),
                ],
            },
            {
                feasible: true,
                executions: [{
                    jobId: "training", locationId: "A", window: secondHour,
                    completedGpuH: 1, remainingGpuH: 0, state: "done", computeKWh: 1, postedChargeUsd: 99,
                }],
                meters: [
                    meter("A", secondHour, { solarKWh: 1, batteryDischargeKWh: 1, curtailedKWh: 1, computeKWh: 1 }),
                    meter("B", secondHour),
                ],
            },
        ],
        transfers: [{
            id: "transfer-1", jobId: "training", fromLocation: "B", toLocation: "A",
            window: { startAt: horizon.startAt, endAt: firstHour.endAt }, energyKWh: 0.5,
            accountingBasis, carbonKg: 0.2, electricityUsd: 0.025, jobChargeUsd: 0.01,
        }],
        costPolicy: { basis: "electricity + carbon at 100 USD/tonne + transfer fee", carbonPriceUsdPerTonne: 100 },
    };
}

test("summarizes recorded fleet meters once including idle sites and transfer effects, separate from posted charges", () => {
    const run = recordedRun();
    const report = summarizeExecution(run);

    expect(report.carbonKg).toBeCloseTo(1.8);
    expect(report.electricityUsd).toBeCloseTo(0.225);
    expect(report.modeledCostUsd).toBeCloseTo(0.415);
    expect(report.work).toEqual([
        { jobId: "training", requiredGpuH: 1, completedGpuH: 1 },
        { jobId: "embeddings", requiredGpuH: 1, completedGpuH: 1 },
    ]);
    expect(report.inventory).toEqual([
        { locationId: "A", initialStoredKWh: 1, endingStoredKWh: 1,
          initialStoredCarbonKg: 0.4, endingStoredCarbonKg: 0.4,
          initialStoredElectricityUsd: 0.05, endingStoredElectricityUsd: 0.05 },
        { locationId: "B", initialStoredKWh: 1, endingStoredKWh: 1,
          initialStoredCarbonKg: 0.4, endingStoredCarbonKg: 0.4,
          initialStoredElectricityUsd: 0.05, endingStoredElectricityUsd: 0.05 },
    ]);
    expect(report.feasible).toBe(true);
});

test("reports supplied solar, storage, curtailment, peak import and observed job delay without recomputing dispatch", () => {
    const report = summarizeExecution(recordedRun());
    expect(report.execution?.scope).toBe("fleet");
    expect(report.execution?.complete).toBe(true);
    expect(report.execution?.sites[0]).toEqual({
        locationId: "A", solarKWh: 3, gridImportKWh: 2,
        batteryChargeKWh: 1, batteryDischargeKWh: 1, curtailedKWh: 1,
        fixedLoadKWh: 2, computeKWh: 2, peakAverageGridImportKW: 1,
        gridImportLimitKW: 3, withinGridImportLimit: true,
    });
    expect(report.execution?.sites[1].fixedLoadKWh).toBe(2);
    expect(report.execution?.jobs).toEqual([
        { jobId: "training", completedGpuH: 1, remainingGpuH: 0, startDelayHours: 1,
            completionObservedAt: horizon.endAt, deadlineMet: true },
        { jobId: "embeddings", completedGpuH: 1, remainingGpuH: 0, startDelayHours: 0,
            completionObservedAt: firstHour.endAt, deadlineMet: true },
    ]);
});

test("exact tick and transfer retries do not duplicate energy, completed work or cost", () => {
    const run = recordedRun();
    const expected = summarizeExecution(run);
    run.ticks = [run.ticks[1], run.ticks[0], structuredClone(run.ticks[0])];
    run.transfers = [run.transfers[0], structuredClone(run.transfers[0])];

    const actual = summarizeExecution(run);
    expect(actual).toEqual(expected);
    expect(actual.execution?.activity.meters).toHaveLength(4);
    expect(actual.execution?.activity.executions).toHaveLength(2);
    expect(actual.execution?.activity.transfers).toHaveLength(1);
});

test("conflicting retry evidence is unavailable instead of silently replacing or adding effects", () => {
    const run = recordedRun();
    const changedTick = structuredClone(run.ticks[0]);
    changedTick.meters[0].carbonKg = 9;
    run.ticks = [...run.ticks, changedTick];

    const report = summarizeExecution(run);
    expect(report.feasible).toBe(false);
    expect(report.execution?.complete).toBe(false);
    expect(report.execution?.unavailableReason).toContain("Conflicting");
    expect(report.carbonKg).toBeNull();
    expect(report.modeledCostUsd).toBeNull();
});

test("missing idle-site coverage, overlapping intervals and an empty recording cannot become a full-horizon saving", () => {
    const missingIdle = recordedRun();
    missingIdle.ticks[1].meters = [missingIdle.ticks[1].meters[0]];
    const overlap = recordedRun();
    overlap.ticks[1].meters[0].window = { startAt: "2026-10-27T12:30:00Z", endAt: horizon.endAt };
    const empty = recordedRun();
    empty.ticks = [];

    for (const run of [missingIdle, overlap, empty]) {
        const report = summarizeExecution(run);
        expect(report.execution?.complete).toBe(false);
        expect(report.feasible).toBe(false);
        expect(report.carbonKg).toBeNull();
        expect(report.electricityUsd).toBeNull();
    }
});

test("known zero effects over fully metered intervals remain zero, while missing totals remain unknown", () => {
    const zero = recordedRun();
    zero.transfers = [];
    zero.ticks.forEach(tick => tick.meters.forEach(meter => {
        meter.carbonKg = 0;
        meter.electricityUsd = 0;
    }));
    expect(summarizeExecution(zero)).toMatchObject({ carbonKg: 0, electricityUsd: 0, modeledCostUsd: 0 });

    const unknownCarbon = recordedRun();
    delete unknownCarbon.ticks[0].meters[1].carbonKg;
    expect(summarizeExecution(unknownCarbon)).toMatchObject({
        carbonKg: null, electricityUsd: 0.225, modeledCostUsd: null,
    });

    const unknownTransferCost = recordedRun();
    delete (unknownTransferCost.transfers[0] as { electricityUsd?: number }).electricityUsd;
    expect(summarizeExecution(unknownTransferCost)).toMatchObject({
        carbonKg: 1.8, electricityUsd: null, modeledCostUsd: null,
    });
});

test("meter and transfer accounting bases must match the declared realized-evidence basis", () => {
    const run = recordedRun();
    run.transfers[0].accountingBasis = "different marginal model";
    const report = summarizeExecution(run);
    expect(report.feasible).toBe(false);
    expect(report.carbonKg).toBeNull();
    expect(report.execution?.unavailableReason).toContain("accounting basis");
});

test("interval-average grid import above the supplied limit is visible and cannot be compared as feasible", () => {
    const run = recordedRun();
    run.sites[0].gridImportLimitKW = 0.5;
    const report = summarizeExecution(run);
    expect(report.execution?.sites[0]).toMatchObject({
        peakAverageGridImportKW: 1, gridImportLimitKW: 0.5, withinGridImportLimit: false,
    });
    expect(report.feasible).toBe(false);

    delete run.sites[0].gridImportLimitKW;
    expect(summarizeExecution(run).execution?.sites[0].withinGridImportLimit).toBeUndefined();
});

test("unfinished work at its deadline is reported as missed instead of a cheaper completed run", () => {
    const run = recordedRun();
    run.ticks[1].executions[0] = {
        ...run.ticks[1].executions[0], completedGpuH: 0.5, remainingGpuH: 0.5, state: "missed",
    };
    const report = summarizeExecution(run);
    expect(report.execution?.jobs[0]).toMatchObject({ completedGpuH: 0.5, remainingGpuH: 0.5, deadlineMet: false });
    expect(report.execution?.jobs[0].completionObservedAt).toBeUndefined();
    expect(report.feasible).toBe(false);
});

test("a job already partly completed only contributes the remaining work declared at the start of this horizon", () => {
    const run = recordedRun();
    run.jobs[0].workGpuH = 5;
    const report = summarizeExecution(run);
    expect(report.work[0]).toEqual({ jobId: "training", requiredGpuH: 1, completedGpuH: 1 });
});

test("report snapshots preserve source and fleet evidence without sharing mutable input arrays", () => {
    const run = recordedRun();
    const report = summarizeExecution(run);
    expect(report.source).toBe("recorded executor observations");
    expect(report.inputRevision).toBe("inputs-1");
    const before = structuredClone(report);
    run.ticks[0].meters[0].gridImportKWh = 99;
    run.transfers[0].energyKWh = 99;
    expect(report).toEqual(before);

    report.execution!.activity.executions[0].completedGpuH = 99;
    expect(run.ticks[0].executions[0].completedGpuH).toBe(1);
});

test("negative electricity prices are retained, while nonfinite or negative physical evidence stays unavailable", () => {
    const negativeCost = recordedRun();
    negativeCost.ticks.forEach(tick => tick.meters.forEach(meter => { meter.electricityUsd = -0.1; }));
    expect(summarizeExecution(negativeCost).modeledCostUsd).toBeCloseTo(-0.185);

    const badEnergy = recordedRun();
    badEnergy.ticks[0].meters[0].gridImportKWh = -1;
    expect(summarizeExecution(badEnergy).execution?.complete).toBe(false);

    const unknownCarbon = recordedRun();
    unknownCarbon.ticks[0].meters[0].carbonKg = Infinity;
    expect(summarizeExecution(unknownCarbon).carbonKg).toBeNull();

    const inconsistentWork = recordedRun();
    inconsistentWork.ticks[0].executions[0].remainingGpuH = 1;
    expect(summarizeExecution(inconsistentWork).execution?.unavailableReason).toContain("do not agree");
});

test("recorded run summaries feed the real comparison and report projection without allocating fleet totals per job", () => {
    const baselineRun = recordedRun();
    const selectedRun = recordedRun();
    selectedRun.arm = "selected";
    selectedRun.ticks.forEach(tick => tick.meters.forEach(meter => {
        meter.carbonKg = 0.2;
        meter.electricityUsd = 0.025;
    }));
    const baseline = summarizeExecution(baselineRun);
    const selected = summarizeExecution(selectedRun);
    const report = createJobReport({ jobId: "training", baseline, selected });

    expect(report.comparison).toBe("comparable");
    expect(carbonReductionKg(report.carbon)).toBeCloseTo(0.8);
    expect(modeledCostReductionUsd(report.cost)).toBeCloseTo(0.18);
    expect(report.execution?.baseline?.scope).toBe("fleet");
    expect(report.execution?.selected?.activity.meters).toHaveLength(4);

    selectedRun.jobId = "embeddings";
    expect(summarizeExecution(selectedRun).carbonKg).toBe(selected.carbonKg);
    report.execution!.selected!.activity.meters[0].carbonKg = 99;
    expect(selected.execution!.activity.meters[0].carbonKg).toBe(0.2);

    selectedRun.ticks[1].meters[0].endingStoredKWh = 0;
    const depleted = createJobReport({
        jobId: "training", baseline, selected: summarizeExecution(selectedRun),
    });
    expect(depleted.comparison).toBe("not-comparable");
    expect(carbonReductionKg(depleted.carbon)).toBeUndefined();
});

test("different numeric carbon prices cannot pass as the same modeled cost policy", () => {
    const baselineRun = recordedRun();
    const selectedRun = recordedRun();
    selectedRun.arm = "selected";
    selectedRun.costPolicy!.carbonPriceUsdPerTonne = 200;
    const report = createJobReport({
        jobId: "training",
        baseline: summarizeExecution(baselineRun),
        selected: summarizeExecution(selectedRun),
    });
    expect(carbonReductionKg(report.carbon)).toBe(0);
    expect(modeledCostReductionUsd(report.cost)).toBeUndefined();
    expect(report.cost.unavailableReason).toContain("cost policy");
});

test("completion observed after the deadline is a missed deadline even when the run is otherwise unavailable", () => {
    const run = recordedRun();
    run.jobs[0].window.endAt = "2026-10-27T13:30:00Z";
    const report = summarizeExecution(run);

    expect(report.execution?.complete).toBe(false);
    expect(report.execution?.jobs[0]).toMatchObject({
        completionObservedAt: "2026-10-27T14:00:00Z", deadlineMet: false,
    });
    expect(report.carbonKg).toBeNull();
});

test("a never-started job ready at 11 and first observed working at 13 has two hours of start delay even when recording starts at 12", () => {
    const run = recordedRun();
    run.jobs[0].window.startAt = "2026-10-27T11:00:00Z";
    run.jobs[0].readyAt = "2026-10-27T11:00:00Z";

    expect(summarizeExecution(run).execution?.jobs[0].startDelayHours).toBe(2);
});

test("prior work or an already-running initial job leaves original start delay unknown", () => {
    const partial = recordedRun();
    partial.jobs[0].workGpuH = 5;
    expect(summarizeExecution(partial).execution?.jobs[0].startDelayHours).toBeUndefined();

    const running = recordedRun();
    running.jobs[0].state = "running";
    expect(summarizeExecution(running).execution?.jobs[0].startDelayHours).toBeUndefined();
});

test("invalid numeric support is retained as raw evidence but omitted from readable site and job summaries", () => {
    const run = recordedRun();
    run.ticks[0].meters[0].gridImportKWh = -1;
    run.ticks[1].executions[0].completedGpuH = Number.NaN;
    const report = summarizeExecution(run);

    expect(report.execution?.complete).toBe(false);
    expect(report.execution?.sites.map(site => site.locationId)).toEqual(["B"]);
    expect(report.execution?.jobs.map(job => job.jobId)).toEqual(["embeddings"]);
    expect(report.execution?.activity.meters[0].gridImportKWh).toBe(-1);
    expect(report.execution?.activity.executions[1].completedGpuH).toBeNaN();
    expect(report.carbonKg).toBeNull();

    const invalidWindow = recordedRun();
    invalidWindow.ticks[0].meters[0].window = { startAt: "unknown", endAt: firstHour.endAt };
    expect(summarizeExecution(invalidWindow).execution?.sites.map(site => site.locationId)).toEqual(["B"]);
});
