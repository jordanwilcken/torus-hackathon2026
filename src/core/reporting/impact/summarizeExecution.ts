import type { TimeWindow } from "../../TimeWindow.type.js";
import type { ExecutionRun, ExecutionSummary } from "../ExecutionEvidence.type.js";
import type { ImpactObservation } from "../ImpactObservation.interface.js";

const flowFields = [
    "solarKWh", "gridImportKWh", "batteryChargeKWh", "batteryDischargeKWh",
    "curtailedKWh", "fixedLoadKWh", "computeKWh",
] as const;

export function summarizeExecution(run: ExecutionRun): ImpactObservation {
    const meterRecords = uniqueRecords(run.ticks.flatMap(tick => tick.meters),
        meter => meter.locationId + windowKey(meter.window));
    const workRecords = uniqueRecords(run.ticks.flatMap(tick => tick.executions),
        work => work.jobId + windowKey(work.window));
    const transferRecords = uniqueRecords(run.transfers, transfer => transfer.id);
    const activity = {
        meters: meterRecords.records,
        executions: workRecords.records,
        transfers: transferRecords.records,
    };
    const unavailableReason = executionEvidenceUnavailableReason(run, activity,
        meterRecords.conflict || workRecords.conflict || transferRecords.conflict);
    const complete = unavailableReason === undefined;
    const sites: ExecutionSummary["sites"] = run.sites.flatMap(site => {
        const meters = activity.meters.filter(meter => meter.locationId === site.locationId);
        if (meters.length === 0 || !nonnegative(site.initialStoredKWh) ||
            site.gridImportLimitKW !== undefined && !nonnegative(site.gridImportLimitKW) ||
            meters.some(meter => !validWindow(meter.window) ||
                ![...flowFields.map(field => meter[field]), meter.endingStoredKWh].every(nonnegative))) return [];
        const peakAverageGridImportKW = Math.max(...meters.map(meter =>
            meter.gridImportKWh / hours(meter.window)));
        const totals = Object.fromEntries(flowFields.map(field => [field, sum(meters.map(meter => meter[field]))])) as
            Pick<ExecutionSummary["sites"][number], typeof flowFields[number]>;
        if (![...Object.values(totals), peakAverageGridImportKW].every(nonnegative)) return [];
        return [{
            locationId: site.locationId,
            ...totals,
            peakAverageGridImportKW,
            gridImportLimitKW: site.gridImportLimitKW,
            withinGridImportLimit: site.gridImportLimitKW === undefined || !nonnegative(site.gridImportLimitKW) ||
                !Number.isFinite(peakAverageGridImportKW)
                ? undefined : peakAverageGridImportKW <= site.gridImportLimitKW + 1e-9,
        }];
    });
    const jobs: ExecutionSummary["jobs"] = run.jobs.flatMap(job => {
        const executions = activity.executions.filter(work => work.jobId === job.id);
        if (![job.remainingGpuH, job.workGpuH].every(nonnegative) || !validWindow(job.window) ||
            !Number.isFinite(Date.parse(job.readyAt)) || executions.some(work =>
                !validWindow(work.window) || ![work.completedGpuH, work.remainingGpuH, work.computeKWh].every(nonnegative))) return [];
        const completedGpuH = sum(executions.map(work => work.completedGpuH));
        const working = executions.filter(work => work.completedGpuH > 0);
        const first = working[0];
        const last = executions.at(-1);
        const remaining = job.remainingGpuH - completedGpuH;
        const finished = approximately(remaining, 0);
        const remainingGpuH = finished ? 0 : remaining;
        if (![completedGpuH, remainingGpuH].every(nonnegative)) return [];
        const completionObservedAt = finished ? working.at(-1)?.window.endAt : undefined;
        const deadline = Date.parse(job.window.endAt);
        const observedThroughDeadline = complete && Date.parse(run.horizon.endAt) >= deadline;
        const deadlineMet = completionObservedAt ? Date.parse(completionObservedAt) <= deadline
            : last?.state === "missed" || (!finished && observedThroughDeadline) ? false : undefined;
        const readyAt = Math.max(Date.parse(job.readyAt), Date.parse(job.window.startAt));
        const originalStartObserved = job.state === "queued" && approximately(job.remainingGpuH, job.workGpuH) &&
            first !== undefined && Date.parse(first.window.startAt) >= readyAt;
        return [{
            jobId: job.id, completedGpuH, remainingGpuH,
            startDelayHours: originalStartObserved ? (Date.parse(first.window.startAt) - readyAt) / 3_600_000 : undefined,
            completionObservedAt, deadlineMet,
        }];
    });
    const inventory = run.sites.flatMap(site => {
        const last = activity.meters.filter(meter => meter.locationId === site.locationId).at(-1);
        return last && Date.parse(last.window.endAt) === Date.parse(run.horizon.endAt)
            ? [{ locationId: site.locationId, initialStoredKWh: site.initialStoredKWh, endingStoredKWh: last.endingStoredKWh }]
            : [];
    });
    const carbonKg = complete ? knownTotal([...activity.meters, ...activity.transfers].map(item =>
        item.carbonKg !== undefined && nonnegative(item.carbonKg) ? item.carbonKg : undefined)) : null;
    const electricityUsd = complete ? knownTotal([...activity.meters, ...activity.transfers].map(item =>
        item.electricityUsd)) : null;
    const transferChargeUsd = knownTotal(activity.transfers.map(transfer => transfer.jobChargeUsd));
    const policy = run.costPolicy;
    const modeledCostUsd = policy && nonnegative(policy.carbonPriceUsdPerTonne) &&
        carbonKg !== null && electricityUsd !== null && transferChargeUsd !== null
        ? finiteOrNull(electricityUsd + carbonKg * policy.carbonPriceUsdPerTonne / 1000 + transferChargeUsd)
        : null;
    const feasible = complete && run.ticks.every(tick => tick.feasible) &&
        sites.every(site => site.withinGridImportLimit !== false) && jobs.every(job => job.deadlineMet !== false);

    return {
        comparisonId: run.comparisonId, inputRevision: run.inputRevision, arm: run.arm, jobId: run.jobId,
        horizon: { ...run.horizon }, accountingBasis: run.accountingBasis, source: run.source,
        simulated: run.simulated, storageToleranceKWh: run.storageToleranceKWh,
        feasible, carbonKg, electricityUsd, modeledCostUsd,
        costBasis: policy?.basis.trim()
            ? policy.basis + " (" + policy.carbonPriceUsdPerTonne + " USD/tonne CO2)" : undefined,
        work: jobs.map(job => ({
            jobId: job.jobId,
            requiredGpuH: run.jobs.find(initial => initial.id === job.jobId)!.remainingGpuH,
            completedGpuH: job.completedGpuH,
        })),
        inventory,
        execution: {
            scope: "fleet", complete, unavailableReason,
            activity: structuredClone(activity), sites, jobs,
        },
    };
}

function executionEvidenceUnavailableReason(
    run: ExecutionRun,
    activity: ExecutionSummary["activity"],
    conflict: boolean,
): string | undefined {
    if (conflict) return "Conflicting observations reuse the same interval or transfer ID.";
    if (!validWindow(run.horizon)) return "A positive reporting horizon is required.";
    if (!uniqueIds(run.sites.map(site => site.locationId)) || !uniqueIds(run.jobs.map(job => job.id)) ||
        !run.jobs.some(job => job.id === run.jobId)) return "A declared site inventory and job cohort are required.";
    if (run.sites.some(site => !nonnegative(site.initialStoredKWh) ||
        site.gridImportLimitKW !== undefined && !nonnegative(site.gridImportLimitKW))) {
        return "Initial storage and utility limits must be finite and nonnegative.";
    }
    for (const site of run.sites) {
        const meters = activity.meters.filter(meter => meter.locationId === site.locationId);
        let through = Date.parse(run.horizon.startAt);
        for (const meter of meters) {
            if (!validWindow(meter.window) || Date.parse(meter.window.startAt) !== through ||
                Date.parse(meter.window.endAt) > Date.parse(run.horizon.endAt)) {
                return "Every site needs non-overlapping meter coverage of the reporting horizon.";
            }
            if (![...flowFields.map(field => meter[field]), meter.endingStoredKWh].every(nonnegative)) {
                return "Metered energy must be finite and nonnegative.";
            }
            through = Date.parse(meter.window.endAt);
        }
        if (through !== Date.parse(run.horizon.endAt)) return "Every site needs complete meter coverage, including idle sites.";
        if (!flowFields.every(field => nonnegative(sum(meters.map(meter => meter[field])))) ||
            meters.some(meter => !nonnegative(meter.gridImportKWh / hours(meter.window)))) {
            return "Accumulated energy and interval-average grid import must be finite.";
        }
    }
    if (activity.meters.some(meter => !run.sites.some(site => site.locationId === meter.locationId))) {
        return "A meter refers to a site outside the declared inventory.";
    }
    if ([...activity.meters, ...activity.transfers].some(item => item.accountingBasis !== run.accountingBasis)) {
        return "All meter and transfer evidence must use the declared accounting basis.";
    }
    for (const job of run.jobs) {
        if (![job.remainingGpuH, job.workGpuH].every(nonnegative) || !validWindow(job.window) || !Number.isFinite(Date.parse(job.readyAt))) {
            return "Each job needs finite remaining work, readiness and a positive execution window.";
        }
        const executions = activity.executions.filter(work => work.jobId === job.id);
        let remaining = job.remainingGpuH;
        let through = Date.parse(run.horizon.startAt);
        for (const work of executions) {
            if (!validWindow(work.window) || Date.parse(work.window.startAt) < through ||
                Date.parse(work.window.endAt) > Date.parse(run.horizon.endAt) ||
                !run.sites.some(site => site.locationId === work.locationId)) {
                return "Job observations must use declared sites and non-overlapping intervals within the horizon.";
            }
            if (![work.completedGpuH, work.remainingGpuH, work.computeKWh].every(nonnegative) ||
                !Number.isFinite(work.postedChargeUsd)) return "Executed work and energy must be finite and nonnegative.";
            remaining -= work.completedGpuH;
            if (!approximately(remaining, work.remainingGpuH) || remaining < -1e-9) {
                return "Recorded completed and remaining work do not agree.";
            }
            if (work.completedGpuH > 0 && (Date.parse(work.window.startAt) <
                Math.max(Date.parse(job.readyAt), Date.parse(job.window.startAt)) ||
                Date.parse(work.window.endAt) > Date.parse(job.window.endAt))) {
                return "Recorded work falls outside the job's ready-to-deadline window.";
            }
            through = Date.parse(work.window.endAt);
        }
    }
    if (activity.executions.some(work => !run.jobs.some(job => job.id === work.jobId))) {
        return "Execution evidence refers to a job outside the declared cohort.";
    }
    for (const transfer of activity.transfers) {
        const start = Date.parse(transfer.window.startAt);
        const end = Date.parse(transfer.window.endAt);
        if (!transfer.id.trim() || !run.jobs.some(job => job.id === transfer.jobId) ||
            !run.sites.some(site => site.locationId === transfer.fromLocation) ||
            !run.sites.some(site => site.locationId === transfer.toLocation) ||
            !Number.isFinite(start) || !Number.isFinite(end) || end < start ||
            start < Date.parse(run.horizon.startAt) || start >= Date.parse(run.horizon.endAt) ||
            !nonnegative(transfer.energyKWh) || !Number.isFinite(transfer.jobChargeUsd)) {
            return "Transfer evidence needs a known job and sites, a start within the horizon and finite effects.";
        }
    }
    return undefined;
}

function uniqueRecords<T extends { window: TimeWindow }>(
    records: readonly T[], key: (record: T) => string,
): { records: T[]; conflict: boolean } {
    const found = new Map<string, T>();
    let conflict = false;
    for (const record of records) {
        const existing = found.get(key(record));
        if (existing) {
            const values = (item: T) => Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
                .map(([name, value]) => name === "window" ? [name, windowKey(item.window)] : [name, value]);
            if (JSON.stringify(values(existing)) !== JSON.stringify(values(record))) conflict = true;
        } else {
            found.set(key(record), record);
        }
    }
    return {
        records: [...found.values()].sort((a, b) => Date.parse(a.window.startAt) - Date.parse(b.window.startAt)),
        conflict,
    };
}

function windowKey(window: TimeWindow): string {
    return ":" + Date.parse(window.startAt) + ":" + Date.parse(window.endAt);
}

function validWindow(window: TimeWindow): boolean {
    return Number.isFinite(Date.parse(window.startAt)) && Number.isFinite(Date.parse(window.endAt)) && hours(window) > 0;
}

function hours(window: TimeWindow): number {
    return (Date.parse(window.endAt) - Date.parse(window.startAt)) / 3_600_000;
}

function uniqueIds(ids: string[]): boolean {
    return ids.length > 0 && ids.every(id => id.trim().length > 0) && new Set(ids).size === ids.length;
}

function nonnegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function approximately(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1e-9 + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 4;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function knownTotal(values: (number | undefined)[]): number | null {
    return values.every(value => value !== undefined && Number.isFinite(value))
        ? finiteOrNull(sum(values as number[])) : null;
}

function finiteOrNull(value: number): number | null {
    return Number.isFinite(value) ? value : null;
}
