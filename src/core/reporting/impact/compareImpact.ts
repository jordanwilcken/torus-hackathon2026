import type { JobObservations } from "../JobObservations.type.js";
import type { JobReport } from "../JobReport.type.js";
import type { ImpactObservation } from "../ImpactObservation.interface.js";
import type { CarbonReport } from "../CarbonReport.type.js";
import type { CostReport } from "../CostReport.type.js";

export function compareImpact(observations: JobObservations): Pick<JobReport, "comparison" | "carbon" | "cost"> {
    const { baseline, selected } = observations;
    const comparisonReason = comparisonUnavailableReason(observations);
    let comparison: JobReport["comparison"] = "unavailable";
    if (baseline && selected) {
        comparison = comparisonReason === undefined ? "comparable" : "not-comparable";
    }

    const carbon: CarbonReport = {
        accountingBasis: baseline?.accountingBasis === selected?.accountingBasis ? baseline?.accountingBasis : undefined,
        baselineCarbonKg: nonnegativeNumberOrUndefined(baseline?.carbonKg),
        selectedCarbonKg: nonnegativeNumberOrUndefined(selected?.carbonKg),
        unavailableReason: comparisonReason,
    };
    if (carbon.unavailableReason === undefined &&
        (carbon.baselineCarbonKg === undefined || carbon.selectedCarbonKg === undefined)) {
        carbon.unavailableReason = "Carbon totals are unavailable for one or both arms.";
    }

    const sameCostBasis = hasNonblankText(baseline?.costBasis) && baseline?.costBasis === selected?.costBasis;
    const cost: CostReport = {
        costBasis: sameCostBasis ? baseline?.costBasis : undefined,
        baselineModeledCostUsd: finiteNumberOrUndefined(baseline?.modeledCostUsd),
        selectedModeledCostUsd: finiteNumberOrUndefined(selected?.modeledCostUsd),
        baselineElectricityUsd: finiteNumberOrUndefined(baseline?.electricityUsd),
        selectedElectricityUsd: finiteNumberOrUndefined(selected?.electricityUsd),
        unavailableReason: comparisonReason,
    };
    if (cost.unavailableReason === undefined) {
        if (!sameCostBasis) {
            cost.unavailableReason = "Comparison arms need the same declared cost policy.";
        } else if (cost.baselineModeledCostUsd === undefined || cost.selectedModeledCostUsd === undefined) {
            cost.unavailableReason = "Modeled cost totals are unavailable for one or both arms.";
        } else if (!Number.isFinite(cost.baselineModeledCostUsd - cost.selectedModeledCostUsd)) {
            cost.unavailableReason = "The modeled cost difference is not finite.";
        }
    }

    return { comparison, carbon, cost };
}

export function carbonReductionKg(carbon: CarbonReport): number | undefined {
    const { baselineCarbonKg, selectedCarbonKg, unavailableReason } = carbon;
    if (unavailableReason !== undefined || baselineCarbonKg === undefined || selectedCarbonKg === undefined) {
        return undefined;
    }
    return baselineCarbonKg - selectedCarbonKg;
}

export function modeledCostReductionUsd(cost: CostReport): number | undefined {
    const { baselineModeledCostUsd, selectedModeledCostUsd, unavailableReason } = cost;
    if (unavailableReason !== undefined || baselineModeledCostUsd === undefined || selectedModeledCostUsd === undefined) {
        return undefined;
    }
    return baselineModeledCostUsd - selectedModeledCostUsd;
}

function comparisonUnavailableReason({ jobId, baseline, selected }: JobObservations): string | undefined {
    if (!baseline && !selected) return "Execution measurements have not been observed.";
    if (!baseline || !selected) return "Both comparison arms are required.";

    return matchingRunsUnavailableReason(baseline, selected)
        ?? completedWorkUnavailableReason(baseline.work, selected.work, jobId)
        ?? storedEnergyUnavailableReason(baseline, selected);
}

function matchingRunsUnavailableReason(baseline: ImpactObservation, selected: ImpactObservation): string | undefined {
    if (!hasNonblankText(baseline.comparisonId) || baseline.comparisonId !== selected.comparisonId) {
        return "Comparison arms have missing or different comparisonId.";
    }
    if (!hasNonblankText(baseline.inputRevision) || baseline.inputRevision !== selected.inputRevision) {
        return "Comparison arms have missing or different inputRevision.";
    }
    if (!hasNonblankText(baseline.accountingBasis) || baseline.accountingBasis !== selected.accountingBasis) {
        return "Comparison arms have missing or different accountingBasis.";
    }
    if (!hasNonblankText(baseline.source) || !hasNonblankText(selected.source)) {
        return "Both comparison arms need a declared evidence source.";
    }
    if (baseline.simulated !== selected.simulated) return "Measured and simulated evidence cannot be mixed.";
    if (baseline.execution && !baseline.execution.complete) return baseline.execution.unavailableReason ?? "Baseline execution evidence is incomplete.";
    if (selected.execution && !selected.execution.complete) return selected.execution.unavailableReason ?? "Selected execution evidence is incomplete.";
    if (!baseline.feasible || !selected.feasible) return "Both comparison runs must be feasible.";

    const baselineStart = Date.parse(baseline.horizon.startAt);
    const baselineEnd = Date.parse(baseline.horizon.endAt);
    const selectedStart = Date.parse(selected.horizon.startAt);
    const selectedEnd = Date.parse(selected.horizon.endAt);
    const validTimestamps = [baselineStart, baselineEnd, selectedStart, selectedEnd].every(Number.isFinite);
    const sameHorizon = baselineStart === selectedStart && baselineEnd === selectedEnd;

    if (!validTimestamps || baselineStart >= baselineEnd || !sameHorizon) {
        return "Comparison arms need the same positive reporting horizon.";
    }
    return undefined;
}

function completedWorkUnavailableReason(
    baselineWork: ImpactObservation["work"],
    selectedWork: ImpactObservation["work"],
    reportJobId: string,
): string | undefined {
    const baselineJobIds = baselineWork.map(work => work.jobId);
    const selectedJobIds = selectedWork.map(work => work.jobId);
    const validJobIds = hasUniqueNonblankIds(baselineJobIds) && hasUniqueNonblankIds(selectedJobIds);

    if (!validJobIds || baselineWork.length === 0 || baselineWork.length !== selectedWork.length ||
        !baselineJobIds.includes(reportJobId)) {
        return "A matching, nonempty work cohort is required.";
    }

    const selectedWorkByJobId = new Map(selectedWork.map(work => [work.jobId, work]));
    const workMismatchReason = "Both arms must complete the same required work.";
    const workToleranceGpuH = 1e-9;

    for (const baselineJob of baselineWork) {
        const selectedJob = selectedWorkByJobId.get(baselineJob.jobId);
        if (!selectedJob) return workMismatchReason;

        const validWorkAmounts = [
            baselineJob.requiredGpuH, baselineJob.completedGpuH,
            selectedJob.requiredGpuH, selectedJob.completedGpuH,
        ].every(isFiniteNonnegative);
        if (!validWorkAmounts || baselineJob.requiredGpuH <= 0) return workMismatchReason;

        const sameRequiredWork = equalWithinTolerance(baselineJob.requiredGpuH, selectedJob.requiredGpuH, workToleranceGpuH);
        const baselineFinished = equalWithinTolerance(baselineJob.completedGpuH, baselineJob.requiredGpuH, workToleranceGpuH);
        const selectedFinished = equalWithinTolerance(selectedJob.completedGpuH, selectedJob.requiredGpuH, workToleranceGpuH);
        if (!sameRequiredWork || !baselineFinished || !selectedFinished) return workMismatchReason;
    }
    return undefined;
}

function storedEnergyUnavailableReason(baseline: ImpactObservation, selected: ImpactObservation): string | undefined {
    const baselineSiteIds = baseline.inventory.map(site => site.locationId);
    const selectedSiteIds = selected.inventory.map(site => site.locationId);
    const validSiteIds = hasUniqueNonblankIds(baselineSiteIds) && hasUniqueNonblankIds(selectedSiteIds);

    if (!validSiteIds || baseline.inventory.length === 0 || baseline.inventory.length !== selected.inventory.length) {
        return "A matching, nonempty site inventory is required.";
    }

    const storageToleranceKWh = baseline.storageToleranceKWh;
    if (!isFiniteNonnegative(storageToleranceKWh) || storageToleranceKWh !== selected.storageToleranceKWh) {
        return "Both arms need the same nonnegative storage tolerance.";
    }

    const selectedInventoryBySiteId = new Map(selected.inventory.map(site => [site.locationId, site]));
    const storageMismatchReason = "Both arms need matching initial and ending stored energy at every site.";

    for (const baselineSite of baseline.inventory) {
        const selectedSite = selectedInventoryBySiteId.get(baselineSite.locationId);
        if (!selectedSite) return storageMismatchReason;

        const validStoredEnergy = [
            baselineSite.initialStoredKWh, baselineSite.endingStoredKWh,
            selectedSite.initialStoredKWh, selectedSite.endingStoredKWh,
        ].every(isFiniteNonnegative);
        if (!validStoredEnergy) return storageMismatchReason;

        const sameInitialStorage = equalWithinTolerance(baselineSite.initialStoredKWh, selectedSite.initialStoredKWh, 0);
        const sameEndingStorage = equalWithinTolerance(
            baselineSite.endingStoredKWh, selectedSite.endingStoredKWh, storageToleranceKWh,
        );
        if (!sameInitialStorage || !sameEndingStorage) return storageMismatchReason;
    }
    return undefined;
}

function hasNonblankText(value: string | undefined): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

function hasUniqueNonblankIds(ids: readonly string[]): boolean {
    return ids.every(hasNonblankText) && new Set(ids).size === ids.length;
}

function isFiniteNonnegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function finiteNumberOrUndefined(value: number | null | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return value;
}

function nonnegativeNumberOrUndefined(value: number | null | undefined): number | undefined {
    if (value === null || value === undefined || !isFiniteNonnegative(value)) return undefined;
    return value;
}

function equalWithinTolerance(baseline: number, selected: number, tolerance: number): boolean {
    const roundingAllowance = Number.EPSILON * Math.max(1, Math.abs(baseline), Math.abs(selected)) * 4;
    return Math.abs(baseline - selected) <= tolerance + roundingAllowance;
}
