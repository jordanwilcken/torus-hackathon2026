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
    expect((finiteNumber(await this.driver.completedGpuHours(arm, job), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:90:14") >= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:90:45") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:90:45")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:90:45"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:90:14"))).toBe(true);
    expect((finiteNumber(await this.driver.completedGpuHours(arm, job), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:91:14") <= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:91:45") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:91:45")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:91:45"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:91:14"))).toBe(true);
  }
  async expectRemainingWork(job: Job, gpuHours: number): Promise<void> {
    expect((finiteNumber(await this.driver.remainingGpuHours(job), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:94:14") >= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:94:40") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:94:40")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:94:40"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:94:14"))).toBe(true);
    expect((finiteNumber(await this.driver.remainingGpuHours(job), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:95:14") <= finiteNumber(finiteNumber((finiteNumber(gpuHours, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:95:40") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:95:40")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:95:40"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:95:14"))).toBe(true);
  }
  async expectSiteEnergy(arm: string, site: string, importedKWh: number, computeKWh: number, storedKWh: number): Promise<void> {
    expect((finiteNumber(await this.driver.gridImportKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:98:14") >= finiteNumber(finiteNumber((finiteNumber(importedKWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:98:42") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:98:42")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:98:42"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:98:14"))).toBe(true);
    expect((finiteNumber(await this.driver.gridImportKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:99:14") <= finiteNumber(finiteNumber((finiteNumber(importedKWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:99:42") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:99:42")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:99:42"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:99:14"))).toBe(true);
    expect((finiteNumber(await this.driver.computeEnergyKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:100:14") >= finiteNumber(finiteNumber((finiteNumber(computeKWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:100:45") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:100:45")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:100:45"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:100:14"))).toBe(true);
    expect((finiteNumber(await this.driver.computeEnergyKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:101:14") <= finiteNumber(finiteNumber((finiteNumber(computeKWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:101:45") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:101:45")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:101:45"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:101:14"))).toBe(true);
    expect((finiteNumber(await this.driver.endingStoredKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:102:14") >= finiteNumber(finiteNumber((finiteNumber(storedKWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:102:44") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:102:44")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:102:44"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:102:14"))).toBe(true);
    expect((finiteNumber(await this.driver.endingStoredKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:103:14") <= finiteNumber(finiteNumber((finiteNumber(storedKWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:103:44") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:103:44")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:103:44"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:103:14"))).toBe(true);
  }
  async expectEstimatedCarbon(baselineKg: number, selectedKg: number, reductionKg: number): Promise<void> {
    expectData(await this.driver.reportIsComparable(), true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("baseline kg CO2"), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:107:14") >= finiteNumber(finiteNumber((finiteNumber(baselineKg, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:107:58") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:107:58")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:107:58"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:107:14"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("baseline kg CO2"), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:108:14") <= finiteNumber(finiteNumber((finiteNumber(baselineKg, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:108:58") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:108:58")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:108:58"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:108:14"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("selected kg CO2"), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:109:14") >= finiteNumber(finiteNumber((finiteNumber(selectedKg, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:109:58") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:109:58")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:109:58"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:109:14"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("selected kg CO2"), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:110:14") <= finiteNumber(finiteNumber((finiteNumber(selectedKg, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:110:58") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:110:58")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:110:58"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:110:14"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("estimated reduction kg CO2"), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:111:14") >= finiteNumber(finiteNumber((finiteNumber(reductionKg, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:111:69") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:111:69")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:111:69"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:111:14"))).toBe(true);
    expect((finiteNumber(await this.driver.carbonComparisonValue("estimated reduction kg CO2"), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:112:14") <= finiteNumber(finiteNumber((finiteNumber(reductionKg, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:112:69") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:112:69")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:112:69"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:112:14"))).toBe(true);
  }
  async expectCurtailedSolar(arm: string, site: string, kWh: number): Promise<void> {
    expect((finiteNumber(await this.driver.curtailedSolarKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:115:14") >= finiteNumber(finiteNumber((finiteNumber(kWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:115:46") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:115:46")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:115:46"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:115:14"))).toBe(true);
    expect((finiteNumber(await this.driver.curtailedSolarKWh(arm, site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:116:14") <= finiteNumber(finiteNumber((finiteNumber(kWh, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:116:46") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:116:46")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:116:46"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:116:14"))).toBe(true);
  }
  async expectExecutionCharges(job: Job, site: string, marketUsd: number, energyUsd: number): Promise<void> {
    expect((finiteNumber(await this.driver.marketPaymentUsd(job), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:119:14") >= finiteNumber(finiteNumber((finiteNumber(marketUsd, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:119:39") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:119:39")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:119:39"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:119:14"))).toBe(true);
    expect((finiteNumber(await this.driver.marketPaymentUsd(job), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:120:14") <= finiteNumber(finiteNumber((finiteNumber(marketUsd, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:120:39") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:120:39")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:120:39"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:120:14"))).toBe(true);
    expect((finiteNumber(await this.driver.electricityChargeUsd("selected", site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:121:14") >= finiteNumber(finiteNumber((finiteNumber(energyUsd, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:121:56") - finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:121:56")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:121:56"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:121:14"))).toBe(true);
    expect((finiteNumber(await this.driver.electricityChargeUsd("selected", site), "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:122:14") <= finiteNumber(finiteNumber((finiteNumber(energyUsd, "left at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:122:56") + finiteNumber(0.000000001, "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:122:56")), "result at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:122:56"), "right at file:///C:/Users/jreys/OneDrive/Documents/ChatGPT/HardTech%20Hackathon/src/impact.examples.expec:122:14"))).toBe(true);
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
