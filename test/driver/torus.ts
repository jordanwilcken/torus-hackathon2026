import type { TimeWindow } from "../../src/core/TimeWindow.type.js";
import type { ImpactObservation } from "../../src/core/reporting/ImpactObservation.interface.js";
import type { JobReport } from "../../src/core/reporting/JobReport.type.js";
import { createJobReport } from "../../src/core/reporting/getJobReport.js";
import { carbonReductionKg, modeledCostReductionUsd } from "../../src/core/reporting/impact/compareImpact.js";
import { reportableJob } from "../../src/core/reporting/impact/reportableJob.js";
import { Job } from "../../src/core/jobs/Job.type.js";
export class TorusDriver {
  private comparisonHorizon?: TimeWindow;
  private comparisonBasis?: string;
  private recordedEvidence = new Map<string, Partial<ImpactObservation>>();
  private recordedInventory: Record<ImpactObservation["arm"], Map<string, ImpactObservation["inventory"][number]>> = {
    baseline: new Map(), selected: new Map(),
  };
  private impact?: JobReport;

  private comparisonArm(arm: string): ImpactObservation["arm"] {
    if (arm !== "baseline" && arm !== "selected") throw new Error("Unknown comparison arm.");
    return arm;
  }

  private evidenceFor(arm: string, job: Job): Partial<ImpactObservation> {
    const key = this.comparisonArm(arm) + ":" + job.id;
    if (!this.recordedEvidence.has(key)) this.recordedEvidence.set(key, {});
    return this.recordedEvidence.get(key)!;
  }

  private currentReport(): JobReport {
    if (!this.impact) throw new Error("Read the impact report before inspecting it.");
    return this.impact;
  }

  async jobForHours(id: string, requiredGpuHours: number, maximumGpus: number, hoursUntilDeadline: number, kWhPerGpuHour: number): Promise<Job> {
    const startAt = "2026-10-27T12:00:00Z";
    return {
      id, workloadRef: id, computeProfile: `test-${kWhPerGpuHour}-kWh-per-GPUh`,
      window: { startAt, endAt: new Date(Date.parse(startAt) + hoursUntilDeadline * 3_600_000).toISOString() },
      allowedLocations: [], homeLocation: "", currentLocation: "", readyAt: startAt,
      workGpuH: requiredGpuHours, remainingGpuH: requiredGpuHours, maxGpus: maximumGpus,
      dataGB: 0, state: "queued",
    };
  }
  async jobPlacement(job: Job, home: string, allowedSites: Array<string>): Promise<void> {
    throw new Error("Not implemented: torus.jobPlacement");
  }
  async siteForCurrentHour(site: string, capGpus: number, solarKWh: number, fixedLoadKWh: number, gridImportLimitKW: number, facilityPowerLimitKW: number): Promise<void> {
    throw new Error("Not implemented: torus.siteForCurrentHour");
  }
  async siteStorage(site: string, capacityKWh: number, storedKWh: number, protectedKWh: number, chargeLimitKW: number, dischargeLimitKW: number, chargeEfficiency: number, dischargeEfficiency: number): Promise<void> {
    throw new Error("Not implemented: torus.siteStorage");
  }
  async currentGridTerms(operationalGramsCO2PerKWh: number, usdPerMWh: number): Promise<void> {
    throw new Error("Not implemented: torus.currentGridTerms");
  }
  async transferAssumptions(hours: number, energyKWh: number, priceUsd: number): Promise<void> {
    throw new Error("Not implemented: torus.transferAssumptions");
  }
  async sameAverageOperationalCO2Basis(): Promise<void> {
    this.comparisonBasis = "average operational CO2 including fleet and transfer effects";
  }
  async homeSiteFifoBaselineWithSameAssetsAndDispatch(): Promise<void> {
    throw new Error("Not implemented: torus.homeSiteFifoBaselineWithSameAssetsAndDispatch");
  }
  async sitePostedPrice(site: string, usdPerGpuHour: number): Promise<void> {
    throw new Error("Not implemented: torus.sitePostedPrice");
  }
  async siteCarbonForecast(site: string, gramsCO2PerKWh: number, source: string): Promise<void> {
    throw new Error("Not implemented: torus.siteCarbonForecast");
  }
  async siteObservedAt(site: string, observedAt: string): Promise<void> {
    throw new Error("Not implemented: torus.siteObservedAt");
  }
  async currentTimeIs(asOf: string): Promise<void> {
    throw new Error("Not implemented: torus.currentTimeIs");
  }
  async maximumEvidenceAgeIs(minutes: number): Promise<void> {
    throw new Error("Not implemented: torus.maximumEvidenceAgeIs");
  }
  async reportingHorizon(startAt: string, endAt: string): Promise<void> {
    this.comparisonHorizon = { startAt, endAt };
  }
  async reportingInventory(arm: string, site: string, initialStoredKWh: number, finalStoredKWh: number): Promise<void> {
    this.recordedInventory[this.comparisonArm(arm)].set(site, {
      locationId: site, initialStoredKWh: initialStoredKWh, endingStoredKWh: finalStoredKWh,
    });
  }
  async completedWorkEvidence(arm: string, job: Job, completedGpuHours: number): Promise<void> {
    this.evidenceFor(arm, job).work = [{ jobId: job.id, requiredGpuH: job.workGpuH, completedGpuH: completedGpuHours }];
  }
  async carbonEvidence(arm: string, job: Job, carbonKg: number): Promise<void> {
    this.evidenceFor(arm, job).carbonKg = carbonKg;
  }
  async unavailableCarbonEvidence(arm: string, job: Job): Promise<void> {
    this.evidenceFor(arm, job).carbonKg = null;
  }
  async routeCurrentSlot(job: Job): Promise<void> {
    throw new Error("Not implemented: torus.routeCurrentSlot");
  }
  async executeSelectedSlot(job: Job): Promise<void> {
    throw new Error("Not implemented: torus.executeSelectedSlot");
  }
  async simulateBothPolicies(job: Job, hours: number): Promise<void> {
    throw new Error("Not implemented: torus.simulateBothPolicies");
  }
  async readImpactReport(job: Job): Promise<void> {
    if (!this.comparisonHorizon || !this.comparisonBasis) throw new Error("Supply the comparison horizon and carbon basis.");
    const observer = reportableJob(job.id);
    for (const arm of ["baseline", "selected"] as const) {
      const recorded = this.evidenceFor(arm, job);
      observer.observe({
        comparisonId: "recorded-comparison", inputRevision: "recorded-inputs-v1", arm, jobId: job.id,
        horizon: this.comparisonHorizon, accountingBasis: this.comparisonBasis,
        source: "supplied recorded comparison evidence", simulated: true, feasible: true,
        carbonKg: recorded.carbonKg ?? null, modeledCostUsd: recorded.modeledCostUsd,
        electricityUsd: recorded.electricityUsd, costBasis: recorded.costBasis,
        work: recorded.work ?? [], inventory: [...this.recordedInventory[arm].values()],
        storageToleranceKWh: 1e-9,
      });
    }
    this.impact = createJobReport(observer.readObservations());
  }
  async findWhereToRunNow(job: Job): Promise<void> {
    throw new Error("Not implemented: torus.findWhereToRunNow");
  }
  async selectedSite(): Promise<string> {
    throw new Error("Not implemented: torus.selectedSite");
  }
  async routingSelected(): Promise<boolean> {
    throw new Error("Not implemented: torus.routingSelected");
  }
  async hasAllocation(): Promise<boolean> {
    throw new Error("Not implemented: torus.hasAllocation");
  }
  async allocationCarbonForecastValue(site: string): Promise<number> {
    throw new Error("Not implemented: torus.allocationCarbonForecastValue");
  }
  async allocationCarbonForecastSource(site: string): Promise<string> {
    throw new Error("Not implemented: torus.allocationCarbonForecastSource");
  }
  async completedJobs(arm: string): Promise<number> {
    throw new Error("Not implemented: torus.completedJobs");
  }
  async completedGpuHours(arm: string, job: Job): Promise<number> {
    throw new Error("Not implemented: torus.completedGpuHours");
  }
  async remainingGpuHours(job: Job): Promise<number> {
    throw new Error("Not implemented: torus.remainingGpuHours");
  }
  async gridImportKWh(arm: string, site: string): Promise<number> {
    throw new Error("Not implemented: torus.gridImportKWh");
  }
  async computeEnergyKWh(arm: string, site: string): Promise<number> {
    throw new Error("Not implemented: torus.computeEnergyKWh");
  }
  async endingStoredKWh(arm: string, site: string): Promise<number> {
    throw new Error("Not implemented: torus.endingStoredKWh");
  }
  async curtailedSolarKWh(arm: string, site: string): Promise<number> {
    throw new Error("Not implemented: torus.curtailedSolarKWh");
  }
  async postedChargeUsd(job: Job): Promise<number> {
    throw new Error("Not implemented: torus.postedChargeUsd");
  }
  async electricityChargeUsd(arm: string, site: string): Promise<number> {
    throw new Error("Not implemented: torus.electricityChargeUsd");
  }
  async carbonComparisonValue(field: string): Promise<number> {
    const report = this.currentReport();
    const totals = report.carbon;
    const values: Record<string, number | undefined> = {
      "baseline kg CO2": totals.baselineCarbonKg, "selected kg CO2": totals.selectedCarbonKg,
      "estimated reduction kg CO2": carbonReductionKg(report.carbon),
    };
    const value = values[field];
    if (value === undefined) throw new Error(`Carbon field is unavailable: ${field}`);
    return value;
  }
  async reportIsComparable(): Promise<boolean> {
    return this.currentReport().comparison === "comparable";
  }
  async reductionIsAvailable(): Promise<boolean> {
    return carbonReductionKg(this.currentReport().carbon) !== undefined;
  }
  async carbonIsAvailable(arm: string): Promise<boolean> {
    const report = this.currentReport().carbon;
    return (this.comparisonArm(arm) === "baseline" ? report.baselineCarbonKg : report.selectedCarbonKg) !== undefined;
  }
  async siteFreshness(site: string): Promise<string> {
    throw new Error("Not implemented: torus.siteFreshness");
  }
  async recommendedNow(site: string): Promise<boolean> {
    throw new Error("Not implemented: torus.recommendedNow");
  }
  async siteUsedGpus(site: string, usedGpus: number): Promise<void> {
    throw new Error("Not implemented: torus.siteUsedGpus");
  }
  async siteUtilityImportLimit(site: string, maximumKW: number): Promise<void> {
    throw new Error("Not implemented: torus.siteUtilityImportLimit");
  }
  async modeledCarbonPriceUsdPerTonne(usd: number): Promise<void> {
    throw new Error("Not implemented: torus.modeledCarbonPriceUsdPerTonne");
  }
  async allocatedGpus(): Promise<number> {
    throw new Error("Not implemented: torus.allocatedGpus");
  }
  async costComparisonValue(field: string): Promise<number> {
    const report = this.currentReport();
    const totals = report.cost;
    const values: Record<string, number | undefined> = {
      "baseline modeled USD": totals.baselineModeledCostUsd, "selected modeled USD": totals.selectedModeledCostUsd,
      "modeled reduction USD": modeledCostReductionUsd(report.cost),
      "baseline electricity USD": totals.baselineElectricityUsd, "selected electricity USD": totals.selectedElectricityUsd,
    };
    const value = values[field];
    if (value === undefined) throw new Error(`Cost field is unavailable: ${field}`);
    return value;
  }
  async costReductionIsAvailable(): Promise<boolean> {
    return modeledCostReductionUsd(this.currentReport().cost) !== undefined;
  }
  async costEvidence(arm: string, job: Job, modeledUsd: number, electricityUsd: number): Promise<void> {
    Object.assign(this.evidenceFor(arm, job), {
      modeledCostUsd: modeledUsd, electricityUsd, costBasis: "shared recorded electricity and modeled-carbon price policy",
    });
  }
  async selectedPostedPrice(): Promise<number> {
    throw new Error("Not implemented: torus.selectedPostedPrice");
  }
}
