import type { TimeWindow } from "../../src/core/TimeWindow.type.js";
import type { ImpactObservation } from "../../src/core/reporting/ImpactObservation.interface.js";
import type { JobReport } from "../../src/core/reporting/JobReport.type.js";
import { createJobReport } from "../../src/core/reporting/getJobReport.js";
import { carbonReductionKg, modeledCostReductionUsd } from "../../src/core/reporting/impact/compareImpact.js";
import { reportableJob } from "../../src/core/reporting/impact/reportableJob.js";
import { Job } from "../../src/core/jobs/Job.type.js";
import { createSiteEnergyLedger } from "../../src/core/energy/site/createSiteEnergyLedger.js";
import { createEnergyMap } from "../../src/core/energy/maps/createEnergyMap.js";
import { getEnergyMap } from "../../src/core/energy/getEnergyMap.js";
import type { SiteEnergyConfiguration } from "../../src/core/energy/site/SiteEnergy.types.js";
import { chooseExecutionSlot } from "../../src/core/scheduling/chooseExecutionSlot.js";
import { quoteSiteEnergy } from "../../src/core/scheduling/quoteSiteEnergy.js";
import { routeAndAcceptJobs } from "../../src/core/scheduling/routeAndAcceptJobs.js";
import type { JobOutcome } from "../../src/core/scheduling/JobOutcome.type.js";
import { createExecutor } from "../../src/core/execution/runner/createExecutor.js";
import type { ExecutionRun } from "../../src/core/reporting/ExecutionEvidence.type.js";
import { summarizeExecution } from "../../src/core/reporting/impact/summarizeExecution.js";

const startAt = "2026-10-27T12:00:00Z";
const currentHour = { startAt, endAt: "2026-10-27T13:00:00Z" };
const accountingBasis = "average operational CO2 including fleet and transfer effects";
type Arm = "baseline" | "selected";
type SiteSetup = {
  capGpus: number; solarKWh: number; fixedLoadKWh: number; gridImportLimitKW: number;
  facilityPowerLimitKW: number; usedGpus?: number; protectedKWh?: number;
  storage?: SiteEnergyConfiguration["storage"]; postedUsdPerGpuHour?: number;
  forecast?: { value: number; source: string }; observedAt?: string;
};
type Runtime = {
  energy: ReturnType<typeof createEnergyMap>; executor: ReturnType<typeof createExecutor>;
  run: ExecutionRun; route: (job: Job, planTransfers: boolean) => Promise<JobOutcome>;
};
/** Supplies declared scenario inputs; all allocation, dispatch and reporting comes from production components. */
export class TorusDriver {
  private sites = new Map<string, SiteSetup>();
  private profiles = new Map<string, number>();
  private grid?: { gramsPerKWh: number; usdPerMWh: number };
  private transfer?: { hours: number; energyKWh: number; priceUsd: number };
  private asOf = startAt;
  private maximumAgeMinutes = 5;
  private carbonPriceUsdPerTonne = 0;
  private baselineEnabled = false;
  private runtimes: Partial<Record<Arm, Runtime>> = {};
  private selection?: JobOutcome;

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
    this.profiles.set(`test-${kWhPerGpuHour}-kWh-per-GPUh`, kWhPerGpuHour);
    return {
      id, workloadRef: id, computeProfile: `test-${kWhPerGpuHour}-kWh-per-GPUh`,
      window: { startAt, endAt: new Date(Date.parse(startAt) + hoursUntilDeadline * 3_600_000).toISOString() },
      allowedLocations: [], homeLocation: "", currentLocation: "", readyAt: startAt,
      workGpuH: requiredGpuHours, remainingGpuH: requiredGpuHours, maxGpus: maximumGpus,
      dataGB: 0, state: "queued",
    };
  }
  async jobPlacement(job: Job, home: string, allowedSites: Array<string>): Promise<void> {
    Object.assign(job, { homeLocation: home, currentLocation: home, allowedLocations: [...allowedSites] });
  }
  async siteForCurrentHour(site: string, capGpus: number, solarKWh: number, fixedLoadKWh: number, gridImportLimitKW: number, facilityPowerLimitKW: number): Promise<void> {
    this.sites.set(site, { capGpus, solarKWh, fixedLoadKWh, gridImportLimitKW, facilityPowerLimitKW });
  }
  async siteStorage(site: string, capacityKWh: number, storedKWh: number, protectedKWh: number, chargeLimitKW: number, dischargeLimitKW: number, chargeEfficiency: number, dischargeEfficiency: number): Promise<void> {
    Object.assign(this.requireSite(site), { protectedKWh, storage: {
      initial: { storedKWh, carbonKg: storedKWh === 0 ? 0 : undefined, electricityUsd: storedKWh === 0 ? 0 : undefined },
      limits: { capacityKWh, chargeKW: chargeLimitKW, dischargeKW: dischargeLimitKW },
      efficiency: { charge: chargeEfficiency, discharge: dischargeEfficiency },
    } });
  }
  async currentGridTerms(operationalGramsCO2PerKWh: number, usdPerMWh: number): Promise<void> {
    this.grid = { gramsPerKWh: operationalGramsCO2PerKWh, usdPerMWh };
  }
  async transferAssumptions(hours: number, energyKWh: number, priceUsd: number): Promise<void> {
    this.transfer = { hours, energyKWh, priceUsd };
  }
  async sameAverageOperationalCO2Basis(): Promise<void> {
    this.comparisonBasis = "average operational CO2 including fleet and transfer effects";
  }
  async homeSiteFifoBaselineWithSameAssetsAndDispatch(): Promise<void> {
    this.baselineEnabled = true;
  }
  async sitePostedPrice(site: string, usdPerGpuHour: number): Promise<void> {
    this.requireSite(site).postedUsdPerGpuHour = usdPerGpuHour;
  }
  async siteCarbonForecast(site: string, gramsCO2PerKWh: number, source: string): Promise<void> {
    this.requireSite(site).forecast = { value: gramsCO2PerKWh, source };
  }
  async siteObservedAt(site: string, observedAt: string): Promise<void> {
    this.requireSite(site).observedAt = observedAt;
  }
  async currentTimeIs(asOf: string): Promise<void> {
    this.asOf = asOf;
  }
  async maximumEvidenceAgeIs(minutes: number): Promise<void> {
    this.maximumAgeMinutes = minutes;
  }
  async reportingHorizon(startAt: string, endAt: string): Promise<void> {
    this.comparisonHorizon = { startAt, endAt };
  }
  async reportingInventory(arm: string, site: string, initialStoredKWh: number, finalStoredKWh: number,
    retained?: { carbonKg: number; electricityUsd: number }): Promise<void> {
    this.recordedInventory[this.comparisonArm(arm)].set(site, {
      locationId: site, initialStoredKWh: initialStoredKWh, endingStoredKWh: finalStoredKWh,
      ...(retained ? { initialStoredCarbonKg: retained.carbonKg, endingStoredCarbonKg: retained.carbonKg,
        initialStoredElectricityUsd: retained.electricityUsd, endingStoredElectricityUsd: retained.electricityUsd } : {}),
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
    const runtime = this.runtimes.selected = this.createRuntime(job, "selected");
    this.selection = await runtime.route(runtime.executor.job(job.id) ?? job, false);
  }
  async executeSelectedSlot(job: Job): Promise<void> {
    const runtime = this.runtimes.selected;
    if (!runtime) throw new Error("Route the supplied job before executing it.");
    await this.dispatch(runtime, job);
  }
  async simulateBothPolicies(job: Job, hours: number): Promise<void> {
    if (hours !== 1) throw new Error("This acceptance scenario supplies one observed hour only.");
    if (!this.baselineEnabled) throw new Error("Declare the home-site FIFO comparison before executing both policies.");
    for (const arm of ["baseline", "selected"] as const) {
      const runtime = this.runtimes[arm] = this.createRuntime(job, arm);
      await this.dispatch(runtime, job);
    }
  }
  async readImpactReport(job: Job): Promise<void> {
    if (this.runtimes.baseline && this.runtimes.selected) {
      const observer = reportableJob(job.id);
      observer.observeJob(job);
      if (this.selection) observer.observeRouting(this.selection);
      observer.observe(summarizeExecution(this.runtimes.baseline.run));
      observer.observe(summarizeExecution(this.runtimes.selected.run));
      this.impact = createJobReport(observer.readObservations(), { fake: false, label: "Calculated modeled execution receipts" });
      return;
    }
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
    await this.routeCurrentSlot(job);
  }
  async selectedSite(): Promise<string> {
    return this.allocation().slot.locationId;
  }
  async routingSelected(): Promise<boolean> {
    return this.selection?.selected === true;
  }
  async hasAllocation(): Promise<boolean> {
    return this.selection?.selected === true;
  }
  async allocationCarbonForecastValue(site: string): Promise<number> {
    const allocation = this.allocation();
    if (allocation.slot.locationId !== site || !allocation.forecast.carbon?.points.length)
      throw new Error("The selected allocation has no carbon forecast for " + site);
    return allocation.forecast.carbon.points[0].value;
  }
  async allocationCarbonForecastSource(site: string): Promise<string> {
    const allocation = this.allocation();
    if (allocation.slot.locationId !== site || !allocation.forecast.carbon)
      throw new Error("The selected allocation has no carbon forecast for " + site);
    return allocation.forecast.carbon.source;
  }
  async completedJobs(arm: string): Promise<number> {
    return this.execution(arm).jobs.filter(job => job.remainingGpuH === 0).length;
  }
  async completedGpuHours(arm: string, job: Job): Promise<number> {
    const observed = this.execution(arm).jobs.find(item => item.jobId === job.id);
    if (!observed) throw new Error("Job missing from execution observations.");
    return observed.completedGpuH;
  }
  async remainingGpuHours(job: Job): Promise<number> {
    const runtime = this.requireRuntime("selected");
    const observed = runtime.executor.job(job.id) ?? runtime.run.jobs.find(item => item.id === job.id);
    if (!observed) throw new Error("Route the job before inspecting remaining work.");
    return observed.remainingGpuH;
  }
  async gridImportKWh(arm: string, site: string): Promise<number> {
    return this.meters(arm, site).reduce((total, meter) => total + meter.gridImportKWh, 0);
  }
  async computeEnergyKWh(arm: string, site: string): Promise<number> {
    return this.meters(arm, site).reduce((total, meter) => total + meter.computeKWh, 0);
  }
  async endingStoredKWh(arm: string, site: string): Promise<number> {
    return this.meters(arm, site).at(-1)!.endingStoredKWh;
  }
  async curtailedSolarKWh(arm: string, site: string): Promise<number> {
    return this.meters(arm, site).reduce((total, meter) => total + meter.curtailedKWh, 0);
  }
  async postedChargeUsd(job: Job): Promise<number> {
    return this.requireRuntime("selected").run.ticks.flatMap(tick => tick.executions).filter(item => item.jobId === job.id).reduce((total, item) => total + item.postedChargeUsd, 0);
  }
  async electricityChargeUsd(arm: string, site: string): Promise<number> {
    return this.meters(arm, site).reduce((total, meter) => {
      if (meter.electricityUsd === undefined) throw new Error("Meter electricity cost is unavailable.");
      return total + meter.electricityUsd;
    }, 0);
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
    const value = this.mapReading(site);
    return value.snapshot.status;
  }
  async recommendedNow(site: string): Promise<boolean> {
    return this.mapReading(site).availableNow;
  }
  async siteUsedGpus(site: string, usedGpus: number): Promise<void> {
    this.requireSite(site).usedGpus = usedGpus;
  }
  async siteUtilityImportLimit(site: string, maximumKW: number): Promise<void> {
    this.requireSite(site).gridImportLimitKW = Math.min(this.requireSite(site).gridImportLimitKW, maximumKW);
  }
  async modeledCarbonPriceUsdPerTonne(usd: number): Promise<void> {
    this.carbonPriceUsdPerTonne = usd;
  }
  async allocatedGpus(): Promise<number> {
    return this.allocation().allocatedGpus;
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
    return this.allocation().postedUsdPerGpuHour;
  }
  outcome(): JobOutcome {
    if (!this.selection) throw new Error("Route the job before observing its selection.");
    return structuredClone(this.selection);
  }

  queryEnergy(query: Parameters<typeof getEnergyMap>[0]) {
    return getEnergyMap(query, this.requireRuntime("selected").energy, this.maximumAgeMinutes);
  }

  observations(): ImpactObservation[] {
    return (["baseline", "selected"] as const).flatMap(arm =>
      this.runtimes[arm] ? [summarizeExecution(this.runtimes[arm]!.run)] : []);
  }

  /** Add the independent home-only arm after the selected route, then execute the same declared hour. */
  async executeComparison(job: Job): Promise<void> {
    if (!this.baselineEnabled) throw new Error("Declare the home-site FIFO comparison.");
    const baseline = this.runtimes.baseline = this.createRuntime(job, "baseline");
    await this.dispatch(baseline, job);
    await this.executeSelectedSlot(job);
  }

  private requireSite(site: string): SiteSetup {
    const setup = this.sites.get(site);
    if (!setup) throw new Error("Supply the site before configuring its storage, pricing or evidence.");
    return setup;
  }

  private requireRuntime(arm: string): Runtime {
    const runtime = this.runtimes[this.comparisonArm(arm)];
    if (!runtime) throw new Error("No real runtime was assembled for " + arm);
    return runtime;
  }

  private allocation() {
    if (!this.selection?.selected) throw new Error("The production chooser did not select an allocation.");
    return this.selection.allocation;
  }

  private execution(arm: string) {
    const execution = summarizeExecution(this.requireRuntime(arm).run).execution;
    if (!execution) throw new Error("The runtime has no execution summary.");
    return execution;
  }

  private meters(arm: string, site: string) {
    const meters = this.requireRuntime(arm).run.ticks.flatMap(tick => tick.meters).filter(meter => meter.locationId === site);
    if (!meters.length) throw new Error("No actual tick meter for " + site);
    return meters;
  }

  private mapReading(site: string) {
    const map = this.queryEnergy({ window: currentHour, asOf: this.asOf });
    const reading = map.sites.get(site)?.slots[0];
    if (!reading) throw new Error("No published slot for " + site);
    return reading;
  }

  private createRuntime(job: Job, arm: Arm): Runtime {
    if (!this.grid || !this.transfer) throw new Error("Supply grid and transfer assumptions.");
    const kWhPerGpuHour = this.profiles.get(job.computeProfile);
    if (kWhPerGpuHour === undefined) throw new Error("Supply the job's compute profile.");
    const sites = [...this.sites].map(([locationId, setup]) => {
      if (!setup.storage || setup.protectedKWh === undefined) throw new Error("Supply storage for " + locationId);
      // Existing literal cases have nonbinding facility limits. Do not silently invent a different limiter.
      if (setup.capGpus * kWhPerGpuHour + setup.fixedLoadKWh > setup.facilityPowerLimitKW)
        throw new Error("This scenario adapter requires a nonbinding facility limit.");
      const ledger = createSiteEnergyLedger({
        locationId, compute: { capGpus: setup.capGpus, kWPerGpu: kWhPerGpuHour },
        storage: setup.storage, accountingBasis,
      }, [{
        window: currentHour,
        supply: { solarKW: setup.solarKWh, fixedLoadKW: setup.fixedLoadKWh,
          gridImportLimitKW: setup.gridImportLimitKW, protectedKWh: setup.protectedKWh },
        evidence: { source: "Declared acceptance model input", version: locationId + "-observed-1",
          observedAt: setup.observedAt ?? startAt, status: "current", projected: false },
        accounting: { solarCarbonGPerKWh: 0, solarUsdPerMWh: 0,
          gridCarbonGPerKWh: this.grid!.gramsPerKWh, gridUsdPerMWh: this.grid!.usdPerMWh },
      }], offer => setup.postedUsdPerGpuHour === undefined
        ? quoteSiteEnergy(offer, { kWhPerGpuHour, carbonPriceUsdPerTonne: this.carbonPriceUsdPerTonne, accountingBasis })
        : { version: offer.version, usdPerGpuHour: setup.postedUsdPerGpuHour,
          basis: "Supplied acceptance posted USD per GPU-hour" });
      if (setup.usedGpus) {
        const reserved = ledger.reserve({ version: ledger.state().version,
          load: { id: locationId + "-existing-work", window: currentHour, gpus: setup.usedGpus } });
        if (!reserved.accepted) throw new Error(reserved.reason);
      }
      return { locationId, computeProfile: job.computeProfile, kWhPerGpuHour, accountingBasis, ledger };
    });
    const energy = createEnergyMap({
      window: currentHour,
      sites: sites.map(site => ({ locationId: site.locationId, regionId: site.locationId, computeProfile: site.computeProfile })),
    }, {
      siteEnergy: { slots: (id, window) => sites.find(site => site.locationId === id)?.ledger.slots(id, window) ?? [] },
      regionalGrid: { read: (id, window) => {
        const forecast = this.requireSite(id).forecast;
        return { observations: [], forecast: forecast ? { carbon: {
          source: forecast.source, scope: id, basis: accountingBasis, unit: "gCO2/kWh",
          retrievedAt: startAt, simulated: true, points: [{ window, value: forecast.value }],
        } } : {} };
      } },
    });
    // Selection-only cases may intentionally supply only the remote destination. No origin capacity is invented.
    const executor = createExecutor({ jobs: sites.some(site => site.locationId === job.currentLocation) ? [job] : [], sites, maximumAgeMinutes: this.maximumAgeMinutes,
      transferTerms: () => this.transfer!.hours === 0 && this.transfer!.energyKWh === 0 && this.transfer!.priceUsd === 0
        ? { bandwidthGBPerHour: 1, kWhPerGB: 1, jobChargeUsdPerGB: 1, accountingBasis,
          carbonGPerKWh: this.grid!.gramsPerKWh, electricityUsdPerMWh: this.grid!.usdPerMWh } : undefined,
    });
    const run: ExecutionRun = {
      comparisonId: "acceptance-execution", inputRevision: "declared-acceptance-inputs-v1", arm, jobId: job.id,
      horizon: currentHour, accountingBasis, source: "Declared model executed by production components", simulated: true,
      storageToleranceKWh: 1e-9, jobs: [structuredClone(job)],
      sites: [...this.sites].map(([locationId, setup]) => ({
        locationId, initialStoredKWh: setup.storage!.initial.storedKWh, gridImportLimitKW: setup.gridImportLimitKW,
        initialStoredCarbonKg: setup.storage!.initial.carbonKg,
        initialStoredElectricityUsd: setup.storage!.initial.electricityUsd,
      })), ticks: [], transfers: [], costPolicy: { basis: "Electricity plus declared modeled carbon price",
        carbonPriceUsdPerTonne: this.carbonPriceUsdPerTonne },
    };
    return { energy, executor, run, route: (current, planTransfers) => chooseExecutionSlot(
      arm === "baseline" ? { ...current, allowedLocations: [current.homeLocation] } : current, energy, {
        asOf: this.asOf, maximumAgeMinutes: this.maximumAgeMinutes, kWhPerGpuHour, planTransfers,
        transferTo: () => ({ hours: this.transfer!.hours, costUsd: this.transfer!.priceUsd }),
      }) };
  }

  private async dispatch(runtime: Runtime, job: Job): Promise<void> {
    const current = runtime.executor.job(job.id);
    if (!current) throw new Error("The executor lost its submitted job.");
    const [result] = await routeAndAcceptJobs([current], { route: candidate => runtime.route(candidate, true) }, runtime.executor);
    if (runtime.run.arm === "selected") this.selection = result.selection;
    if (result.transfer?.started) runtime.run.transfers = [...runtime.run.transfers, result.transfer.evidence];
    const tick = runtime.executor.tick(currentHour);
    if (!tick.feasible) throw new Error("Production executor rejected the supplied tick: " + JSON.stringify(tick));
    runtime.run.ticks = [...runtime.run.ticks, tick];
  }

}
