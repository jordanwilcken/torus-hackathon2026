import { expect } from "vitest";
import { expectData, comparisonEqual, finiteNumber } from "./comparison.js";
import { TorusDriver } from "../driver/torus.js";
import { Job } from "../../src/core/jobs/Job.type.js";
export class Torus {
  constructor(private readonly driver: TorusDriver) {}

  async jobForHours(id: string, requiredGpuHours: number, maximumGpus: number, hoursUntilDeadline: number, kWhPerGpuHour: number, budgetUsd: number): Promise<Job> {
    return await this.driver.jobForHours(id, requiredGpuHours, maximumGpus, hoursUntilDeadline, kWhPerGpuHour, budgetUsd);
  }
  async jobPlacement(job: Job, home: string, allowedSites: Array<string>): Promise<void> {
    return await this.driver.jobPlacement(job, home, allowedSites);
  }
  async siteForCurrentHour(site: string, availableGpus: number, solarKWh: number, fixedLoadKWh: number, gridImportLimitKW: number, facilityPowerLimitKW: number): Promise<void> {
    return await this.driver.siteForCurrentHour(site, availableGpus, solarKWh, fixedLoadKWh, gridImportLimitKW, facilityPowerLimitKW);
  }
  async siteStorage(site: string, capacityKWh: number, storedKWh: number, protectedKWh: number, chargeLimitKW: number, dischargeLimitKW: number, chargeEfficiency: number, dischargeEfficiency: number): Promise<void> {
    return await this.driver.siteStorage(site, capacityKWh, storedKWh, protectedKWh, chargeLimitKW, dischargeLimitKW, chargeEfficiency, dischargeEfficiency);
  }
  async currentGridTerms(operationalGramsCO2PerKWh: number, usdPerMWh: number): Promise<void> {
    return await this.driver.currentGridTerms(operationalGramsCO2PerKWh, usdPerMWh);
  }
  async transferAssumptions(hours: number, energyKWh: number, priceUsd: number): Promise<void> {
    return await this.driver.transferAssumptions(hours, energyKWh, priceUsd);
  }
  async sameAverageOperationalCO2Basis(): Promise<void> {
    return await this.driver.sameAverageOperationalCO2Basis();
  }
  async homeSiteFifoBaselineWithSameAssetsAndDispatch(): Promise<void> {
    return await this.driver.homeSiteFifoBaselineWithSameAssetsAndDispatch();
  }
  async preferLowestEstimatedCarbon(): Promise<void> {
    return await this.driver.preferLowestEstimatedCarbon();
  }
  async siteOfferPrice(site: string, usdPerGpuHour: number): Promise<void> {
    return await this.driver.siteOfferPrice(site, usdPerGpuHour);
  }
  async siteCarbonForecast(site: string, gramsCO2PerKWh: number, source: string): Promise<void> {
    return await this.driver.siteCarbonForecast(site, gramsCO2PerKWh, source);
  }
  async siteObservedAt(site: string, observedAt: string): Promise<void> {
    return await this.driver.siteObservedAt(site, observedAt);
  }
  async currentTimeIs(asOf: string): Promise<void> {
    return await this.driver.currentTimeIs(asOf);
  }
  async maximumEvidenceAgeIs(minutes: number): Promise<void> {
    return await this.driver.maximumEvidenceAgeIs(minutes);
  }
  async reportingHorizon(startAt: string, endAt: string): Promise<void> {
    return await this.driver.reportingHorizon(startAt, endAt);
  }
  async reportingInventory(arm: string, site: string, initialStoredKWh: number, finalStoredKWh: number): Promise<void> {
    return await this.driver.reportingInventory(arm, site, initialStoredKWh, finalStoredKWh);
  }
  async completedWorkEvidence(arm: string, job: Job, completedGpuHours: number): Promise<void> {
    return await this.driver.completedWorkEvidence(arm, job, completedGpuHours);
  }
  async carbonEvidence(arm: string, job: Job, carbonKg: number): Promise<void> {
    return await this.driver.carbonEvidence(arm, job, carbonKg);
  }
  async unavailableCarbonEvidence(arm: string, job: Job): Promise<void> {
    return await this.driver.unavailableCarbonEvidence(arm, job);
  }
  async routeCurrentSlot(job: Job): Promise<void> {
    return await this.driver.routeCurrentSlot(job);
  }
  async executeSelectedSlot(job: Job): Promise<void> {
    return await this.driver.executeSelectedSlot(job);
  }
  async simulateBothPolicies(job: Job, hours: number): Promise<void> {
    return await this.driver.simulateBothPolicies(job, hours);
  }
  async readImpactReport(job: Job): Promise<void> {
    return await this.driver.readImpactReport(job);
  }
  async findWhereToRunNow(job: Job): Promise<void> {
    return await this.driver.findWhereToRunNow(job);
  }
  async selectedSite(): Promise<string> {
    return await this.driver.selectedSite();
  }
  async routingSelected(): Promise<boolean> {
    return await this.driver.routingSelected();
  }
  async hasSelectedBid(): Promise<boolean> {
    return await this.driver.hasSelectedBid();
  }
  async siteOfferCount(site: string): Promise<number> {
    return await this.driver.siteOfferCount(site);
  }
  async jobCapacityBidCount(job: Job): Promise<number> {
    return await this.driver.jobCapacityBidCount(job);
  }
  async bidCarbonForecastValue(site: string): Promise<number> {
    return await this.driver.bidCarbonForecastValue(site);
  }
  async bidCarbonForecastSource(site: string): Promise<string> {
    return await this.driver.bidCarbonForecastSource(site);
  }
  async completedJobs(arm: string): Promise<number> {
    return await this.driver.completedJobs(arm);
  }
  async completedGpuHours(arm: string, job: Job): Promise<number> {
    return await this.driver.completedGpuHours(arm, job);
  }
  async remainingGpuHours(job: Job): Promise<number> {
    return await this.driver.remainingGpuHours(job);
  }
  async gridImportKWh(arm: string, site: string): Promise<number> {
    return await this.driver.gridImportKWh(arm, site);
  }
  async computeEnergyKWh(arm: string, site: string): Promise<number> {
    return await this.driver.computeEnergyKWh(arm, site);
  }
  async endingStoredKWh(arm: string, site: string): Promise<number> {
    return await this.driver.endingStoredKWh(arm, site);
  }
  async curtailedSolarKWh(arm: string, site: string): Promise<number> {
    return await this.driver.curtailedSolarKWh(arm, site);
  }
  async marketPaymentUsd(job: Job): Promise<number> {
    return await this.driver.marketPaymentUsd(job);
  }
  async electricityChargeUsd(arm: string, site: string): Promise<number> {
    return await this.driver.electricityChargeUsd(arm, site);
  }
  async carbonComparisonValue(field: string): Promise<number> {
    return await this.driver.carbonComparisonValue(field);
  }
  async reportIsComparable(): Promise<boolean> {
    return await this.driver.reportIsComparable();
  }
  async reductionIsAvailable(): Promise<boolean> {
    return await this.driver.reductionIsAvailable();
  }
  async carbonIsAvailable(arm: string): Promise<boolean> {
    return await this.driver.carbonIsAvailable(arm);
  }
  async siteFreshness(site: string): Promise<string> {
    return await this.driver.siteFreshness(site);
  }
  async recommendedNow(site: string): Promise<boolean> {
    return await this.driver.recommendedNow(site);
  }
  async expectSelectedSite(expected: string): Promise<void> {
    expectData(await this.driver.routingSelected(), true);
    expectData(await this.driver.hasSelectedBid(), true);
    expectData(await this.driver.selectedSite(), expected);
  }
  async expectNoSelection(): Promise<void> {
    expectData(await this.driver.routingSelected(), false);
    expectData(await this.driver.hasSelectedBid(), false);
  }
  async expectSiteOfferCount(site: string, expected: number): Promise<void> {
    expectData(await this.driver.siteOfferCount(site), expected);
  }
  async expectCapacityBidCount(job: Job, expected: number): Promise<void> {
    expectData(await this.driver.jobCapacityBidCount(job), expected);
  }
  async expectBidCarbonForecast(site: string, gramsCO2PerKWh: number, source: string): Promise<void> {
    expectData(await this.driver.bidCarbonForecastValue(site), gramsCO2PerKWh);
    expectData(await this.driver.bidCarbonForecastSource(site), source);
  }
  async expectCompletedWork(arm: string, job: Job, jobs: number, gpuHours: number): Promise<void> {
    expectData(await this.driver.completedJobs(arm), jobs);
    expect((finiteNumber(await this.driver.completedGpuHours(arm, job), "left at test/dsl/torus.ts:167") >= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at test/dsl/torus.ts:167") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:167")), "result at test/dsl/torus.ts:167"), "right at test/dsl/torus.ts:167"))).toBe(true);
    expect((finiteNumber(await this.driver.completedGpuHours(arm, job), "left at test/dsl/torus.ts:168") <= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at test/dsl/torus.ts:168") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:168")), "result at test/dsl/torus.ts:168"), "right at test/dsl/torus.ts:168"))).toBe(true);
  }
  async expectRemainingWork(job: Job, gpuHours: number): Promise<void> {
    expect((finiteNumber(await this.driver.remainingGpuHours(job), "left at test/dsl/torus.ts:171") >= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at test/dsl/torus.ts:171") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:171")), "result at test/dsl/torus.ts:171"), "right at test/dsl/torus.ts:171"))).toBe(true);
    expect((finiteNumber(await this.driver.remainingGpuHours(job), "left at test/dsl/torus.ts:172") <= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at test/dsl/torus.ts:172") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:172")), "result at test/dsl/torus.ts:172"), "right at test/dsl/torus.ts:172"))).toBe(true);
  }
  async expectSiteEnergy(arm: string, site: string, importedKWh: number, computeKWh: number, storedKWh: number): Promise<void> {
    expect((finiteNumber(await this.driver.gridImportKWh(arm, site), "left at test/dsl/torus.ts:175") >= finiteNumber(finiteNumber((finiteNumber(importedKWh, "left at test/dsl/torus.ts:175") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:175")), "result at test/dsl/torus.ts:175"), "right at test/dsl/torus.ts:175"))).toBe(true);
    expect((finiteNumber(await this.driver.gridImportKWh(arm, site), "left at test/dsl/torus.ts:176") <= finiteNumber(finiteNumber((finiteNumber(importedKWh, "left at test/dsl/torus.ts:176") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:176")), "result at test/dsl/torus.ts:176"), "right at test/dsl/torus.ts:176"))).toBe(true);
    expect((finiteNumber(await this.driver.computeEnergyKWh(arm, site), "left at test/dsl/torus.ts:177") >= finiteNumber(finiteNumber((finiteNumber(computeKWh, "left at test/dsl/torus.ts:177") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:177")), "result at test/dsl/torus.ts:177"), "right at test/dsl/torus.ts:177"))).toBe(true);
    expect((finiteNumber(await this.driver.computeEnergyKWh(arm, site), "left at test/dsl/torus.ts:178") <= finiteNumber(finiteNumber((finiteNumber(computeKWh, "left at test/dsl/torus.ts:178") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:178")), "result at test/dsl/torus.ts:178"), "right at test/dsl/torus.ts:178"))).toBe(true);
    expect((finiteNumber(await this.driver.endingStoredKWh(arm, site), "left at test/dsl/torus.ts:179") >= finiteNumber(finiteNumber((finiteNumber(storedKWh, "left at test/dsl/torus.ts:179") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:179")), "result at test/dsl/torus.ts:179"), "right at test/dsl/torus.ts:179"))).toBe(true);
    expect((finiteNumber(await this.driver.endingStoredKWh(arm, site), "left at test/dsl/torus.ts:180") <= finiteNumber(finiteNumber((finiteNumber(storedKWh, "left at test/dsl/torus.ts:180") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:180")), "result at test/dsl/torus.ts:180"), "right at test/dsl/torus.ts:180"))).toBe(true);
  }
  async expectEstimatedCarbon(baselineKg: number, selectedKg: number, reductionKg: number): Promise<void> {
    expectData(await this.driver.reportIsComparable(), true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("baseline kg CO2"), "left at test/dsl/torus.ts:184") >= finiteNumber(finiteNumber((finiteNumber(baselineKg, "left at test/dsl/torus.ts:184") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:184")), "result at test/dsl/torus.ts:184"), "right at test/dsl/torus.ts:184"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("baseline kg CO2"), "left at test/dsl/torus.ts:185") <= finiteNumber(finiteNumber((finiteNumber(baselineKg, "left at test/dsl/torus.ts:185") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:185")), "result at test/dsl/torus.ts:185"), "right at test/dsl/torus.ts:185"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("selected kg CO2"), "left at test/dsl/torus.ts:186") >= finiteNumber(finiteNumber((finiteNumber(selectedKg, "left at test/dsl/torus.ts:186") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:186")), "result at test/dsl/torus.ts:186"), "right at test/dsl/torus.ts:186"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("selected kg CO2"), "left at test/dsl/torus.ts:187") <= finiteNumber(finiteNumber((finiteNumber(selectedKg, "left at test/dsl/torus.ts:187") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:187")), "result at test/dsl/torus.ts:187"), "right at test/dsl/torus.ts:187"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("estimated reduction kg CO2"), "left at test/dsl/torus.ts:188") >= finiteNumber(finiteNumber((finiteNumber(reductionKg, "left at test/dsl/torus.ts:188") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:188")), "result at test/dsl/torus.ts:188"), "right at test/dsl/torus.ts:188"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("estimated reduction kg CO2"), "left at test/dsl/torus.ts:189") <= finiteNumber(finiteNumber((finiteNumber(reductionKg, "left at test/dsl/torus.ts:189") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:189")), "result at test/dsl/torus.ts:189"), "right at test/dsl/torus.ts:189"))).toBe(true);
  }
  async expectCurtailedSolar(arm: string, site: string, kWh: number): Promise<void> {
    expect((finiteNumber(await this.driver.curtailedSolarKWh(arm, site), "left at test/dsl/torus.ts:192") >= finiteNumber(finiteNumber((finiteNumber(kWh, "left at test/dsl/torus.ts:192") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:192")), "result at test/dsl/torus.ts:192"), "right at test/dsl/torus.ts:192"))).toBe(true);
    expect((finiteNumber(await this.driver.curtailedSolarKWh(arm, site), "left at test/dsl/torus.ts:193") <= finiteNumber(finiteNumber((finiteNumber(kWh, "left at test/dsl/torus.ts:193") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:193")), "result at test/dsl/torus.ts:193"), "right at test/dsl/torus.ts:193"))).toBe(true);
  }
  async expectExecutionCharges(job: Job, site: string, marketUsd: number, energyUsd: number): Promise<void> {
    expect((finiteNumber(await this.driver.marketPaymentUsd(job), "left at test/dsl/torus.ts:196") >= finiteNumber(finiteNumber((finiteNumber(marketUsd, "left at test/dsl/torus.ts:196") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:196")), "result at test/dsl/torus.ts:196"), "right at test/dsl/torus.ts:196"))).toBe(true);
    expect((finiteNumber(await this.driver.marketPaymentUsd(job), "left at test/dsl/torus.ts:197") <= finiteNumber(finiteNumber((finiteNumber(marketUsd, "left at test/dsl/torus.ts:197") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:197")), "result at test/dsl/torus.ts:197"), "right at test/dsl/torus.ts:197"))).toBe(true);
    expect((finiteNumber(await this.driver.electricityChargeUsd("selected", site), "left at test/dsl/torus.ts:198") >= finiteNumber(finiteNumber((finiteNumber(energyUsd, "left at test/dsl/torus.ts:198") - finiteNumber(0.000000001, "right at test/dsl/torus.ts:198")), "result at test/dsl/torus.ts:198"), "right at test/dsl/torus.ts:198"))).toBe(true);
    expect((finiteNumber(await this.driver.electricityChargeUsd("selected", site), "left at test/dsl/torus.ts:199") <= finiteNumber(finiteNumber((finiteNumber(energyUsd, "left at test/dsl/torus.ts:199") + finiteNumber(0.000000001, "right at test/dsl/torus.ts:199")), "result at test/dsl/torus.ts:199"), "right at test/dsl/torus.ts:199"))).toBe(true);
  }
  async expectStaleSiteNotRecommended(site: string): Promise<void> {
    expectData(await this.driver.siteFreshness(site), "stale");
    expectData(await this.driver.recommendedNow(site), false);
  }
  async expectCurrentSiteRecommended(site: string): Promise<void> {
    expectData(await this.driver.siteFreshness(site), "current");
    expectData(await this.driver.recommendedNow(site), true);
  }
  async expectUnequalWorkNotComparable(): Promise<void> {
    expectData(await this.driver.reportIsComparable(), false);
    expectData(await this.driver.reductionIsAvailable(), false);
  }
  async expectSelectedCarbonUnknown(): Promise<void> {
    expectData(await this.driver.carbonIsAvailable("baseline"), true);
    expectData(await this.driver.carbonIsAvailable("selected"), false);
    expectData(await this.driver.reductionIsAvailable(), false);
  }
}
