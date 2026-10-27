import { Job } from "../../src/core/jobs/Job.type.js";
export class TorusDriver {
  async jobForHours(id: string, requiredGpuHours: number, maximumGpus: number, hoursUntilDeadline: number, kWhPerGpuHour: number): Promise<Job> {
    throw new Error("Not implemented: torus.jobForHours");
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
    throw new Error("Not implemented: torus.sameAverageOperationalCO2Basis");
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
    throw new Error("Not implemented: torus.reportingHorizon");
  }
  async reportingInventory(arm: string, site: string, initialStoredKWh: number, finalStoredKWh: number): Promise<void> {
    throw new Error("Not implemented: torus.reportingInventory");
  }
  async completedWorkEvidence(arm: string, job: Job, completedGpuHours: number): Promise<void> {
    throw new Error("Not implemented: torus.completedWorkEvidence");
  }
  async carbonEvidence(arm: string, job: Job, carbonKg: number): Promise<void> {
    throw new Error("Not implemented: torus.carbonEvidence");
  }
  async unavailableCarbonEvidence(arm: string, job: Job): Promise<void> {
    throw new Error("Not implemented: torus.unavailableCarbonEvidence");
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
    throw new Error("Not implemented: torus.readImpactReport");
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
    throw new Error("Not implemented: torus.carbonComparisonValue");
  }
  async reportIsComparable(): Promise<boolean> {
    throw new Error("Not implemented: torus.reportIsComparable");
  }
  async reductionIsAvailable(): Promise<boolean> {
    throw new Error("Not implemented: torus.reductionIsAvailable");
  }
  async carbonIsAvailable(arm: string): Promise<boolean> {
    throw new Error("Not implemented: torus.carbonIsAvailable");
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
    throw new Error("Not implemented: torus.costComparisonValue");
  }
  async costReductionIsAvailable(): Promise<boolean> {
    throw new Error("Not implemented: torus.costReductionIsAvailable");
  }
  async costEvidence(arm: string, job: Job, modeledUsd: number, electricityUsd: number): Promise<void> {
    throw new Error("Not implemented: torus.costEvidence");
  }
  async selectedPostedPrice(): Promise<number> {
    throw new Error("Not implemented: torus.selectedPostedPrice");
  }
}
