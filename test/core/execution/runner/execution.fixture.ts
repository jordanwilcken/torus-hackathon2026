import { expect, test as baseTest } from "vitest";
import { createSiteEnergyLedger } from "../../../../src/core/energy/site/createSiteEnergyLedger.js";
import { createEnergyMap } from "../../../../src/core/energy/maps/createEnergyMap.js";
import { chooseExecutionSlot } from "../../../../src/core/scheduling/chooseExecutionSlot.js";
import { createExecutor } from "../../../../src/core/execution/runner/createExecutor.js";
import type { Job } from "../../../../src/core/jobs/Job.type.js";
import type { JobOutcome } from "../../../../src/core/scheduling/JobOutcome.type.js";
import type { TickObservation } from "../../../../src/core/execution/TickObservation.type.js";
import type { SiteEnergyConfiguration } from "../../../../src/core/energy/site/SiteEnergy.types.js";

const startAt = "2026-10-27T12:00:00Z";
const currentHour = { startAt, endAt: "2026-10-27T13:00:00Z" };
const accountingBasis = "Supplied acceptance scenario; average operational consumption accounting";
type SiteSetup = {
    capGpus: number; solarKWh: number; fixedLoadKWh: number;
    gridImportLimitKW: number; facilityPowerLimitKW: number;
    storage?: SiteEnergyConfiguration["storage"];
    protectedKWh?: number;
    postedUsdPerGpuHour?: number;
};

/** Binds the existing partial-tick story only; it contains no routing, dispatch or accounting policy. */
class ExecutionScenario {
    private jobs = new Map<string, Job>();
    private profiles = new Map<string, number>();
    private sites = new Map<string, SiteSetup>();
    private grid?: { gramsPerKWh: number; usdPerMWh: number };
    private transfer?: { hours: number; energyKWh: number; priceUsd: number };
    private runner?: ReturnType<typeof createExecutor>;
    private selection?: JobOutcome;
    private tick?: TickObservation;

    async jobForHours(id: string, requiredGpuHours: number, maximumGpus: number, hoursUntilDeadline: number,
        kWhPerGpuHour: number): Promise<Job> {
        const computeProfile = `acceptance-${kWhPerGpuHour}-kWh-per-GPUh`;
        const job: Job = {
            id, workloadRef: id, computeProfile,
            window: { startAt, endAt: new Date(Date.parse(startAt) + hoursUntilDeadline * 3_600_000).toISOString() },
            allowedLocations: [], homeLocation: "", currentLocation: "", readyAt: startAt,
            workGpuH: requiredGpuHours, remainingGpuH: requiredGpuHours, maxGpus: maximumGpus,
            dataGB: 0, state: "queued",
        };
        this.jobs.set(id, job);
        this.profiles.set(computeProfile, kWhPerGpuHour);
        return job;
    }

    async jobPlacement(job: Job, home: string, allowedSites: string[]): Promise<void> {
        Object.assign(job, { homeLocation: home, currentLocation: home, allowedLocations: [...allowedSites] });
    }

    async siteForCurrentHour(locationId: string, capGpus: number, solarKWh: number, fixedLoadKWh: number,
        gridImportLimitKW: number, facilityPowerLimitKW: number): Promise<void> {
        this.sites.set(locationId, { capGpus, solarKWh, fixedLoadKWh, gridImportLimitKW, facilityPowerLimitKW });
    }

    async siteStorage(locationId: string, capacityKWh: number, storedKWh: number, protectedKWh: number,
        chargeLimitKW: number, dischargeLimitKW: number, chargeEfficiency: number, dischargeEfficiency: number): Promise<void> {
        Object.assign(this.requireSite(locationId), {
            protectedKWh,
            storage: {
                initial: { storedKWh, carbonKg: storedKWh === 0 ? 0 : undefined, electricityUsd: storedKWh === 0 ? 0 : undefined },
                limits: { capacityKWh, chargeKW: chargeLimitKW, dischargeKW: dischargeLimitKW },
                efficiency: { charge: chargeEfficiency, discharge: dischargeEfficiency },
            },
        });
    }

    async currentGridTerms(gramsPerKWh: number, usdPerMWh: number): Promise<void> {
        this.grid = { gramsPerKWh, usdPerMWh };
    }

    async transferAssumptions(hours: number, energyKWh: number, priceUsd: number): Promise<void> {
        this.transfer = { hours, energyKWh, priceUsd };
    }

    async sitePostedPrice(locationId: string, usdPerGpuHour: number): Promise<void> {
        this.requireSite(locationId).postedUsdPerGpuHour = usdPerGpuHour;
    }

    async routeCurrentSlot(job: Job): Promise<void> {
        if (!this.grid || !this.transfer) throw new Error("Supply grid and transfer assumptions before routing.");
        const kWhPerGpuHour = this.profiles.get(job.computeProfile)!;
        const ledgers = [...this.sites].map(([locationId, setup]) => {
            if (!setup.storage || setup.postedUsdPerGpuHour === undefined || setup.protectedKWh === undefined)
                throw new Error("Supply storage and a quote for every acceptance site.");
            // This story's complete GPU capacity is below its facility limit. The adapter does not implement a new limiter.
            if (setup.capGpus * kWhPerGpuHour + setup.fixedLoadKWh > setup.facilityPowerLimitKW)
                throw new Error("This partial-tick fixture requires a nonbinding facility limit.");
            const ledger = createSiteEnergyLedger({
                locationId, compute: { capGpus: setup.capGpus, kWPerGpu: kWhPerGpuHour },
                storage: setup.storage, accountingBasis,
            }, [{
                window: { ...currentHour },
                supply: { solarKW: setup.solarKWh, fixedLoadKW: setup.fixedLoadKWh,
                    gridImportLimitKW: setup.gridImportLimitKW, protectedKWh: setup.protectedKWh },
                evidence: { source: "Supplied execution acceptance input", version: `${locationId}-input-1`,
                    observedAt: startAt, status: "current", projected: false },
                accounting: { solarCarbonGPerKWh: 0, gridCarbonGPerKWh: this.grid!.gramsPerKWh,
                    solarUsdPerMWh: 0, gridUsdPerMWh: this.grid!.usdPerMWh },
            }], offer => ({ version: offer.version, usdPerGpuHour: setup.postedUsdPerGpuHour!,
                basis: "Supplied acceptance posted USD per GPU-hour" }));
            return { locationId, computeProfile: job.computeProfile, kWhPerGpuHour, accountingBasis, ledger };
        });
        const byLocation = new Map(ledgers.map(site => [site.locationId, site.ledger]));
        const energy = createEnergyMap({ window: currentHour,
            sites: ledgers.map(site => ({ locationId: site.locationId, regionId: "supplied-region", computeProfile: site.computeProfile })),
        }, {
            siteEnergy: { slots: (locationId, window) => byLocation.get(locationId)?.slots(locationId, window) ?? [] },
            regionalGrid: { read: () => ({ observations: [], forecast: {} }) },
        });
        this.runner = createExecutor({ jobs: [...this.jobs.values()], sites: ledgers, maximumAgeMinutes: 5,
            transferTerms: () => undefined });
        this.selection = await chooseExecutionSlot(job, energy, {
            asOf: startAt, maximumAgeMinutes: 5, kWhPerGpuHour,
            transferTo: () => ({ hours: this.transfer!.hours, costUsd: this.transfer!.priceUsd }),
        });
    }

    async executeSelectedSlot(_job: Job): Promise<void> {
        if (!this.runner || !this.selection?.selected) throw new Error("Route a selected current allocation before executing.");
        expect(this.runner.accept(this.selection)).toBe(true);
        this.tick = this.runner.tick(currentHour);
        expect(this.tick.feasible).toBe(true);
    }

    async expectSelectedSite(locationId: string): Promise<void> {
        expect(this.selection?.selected).toBe(true);
        if (!this.selection?.selected) throw new Error("The real chooser did not select a site.");
        expect(this.selection.allocation.slot.locationId).toBe(locationId);
    }

    async expectCompletedWork(arm: string, job: Job, completedJobs: number, gpuHours: number): Promise<void> {
        expect(arm).toBe("selected");
        const executions = this.observation().executions.filter(execution => execution.jobId === job.id);
        expect(executions.filter(execution => execution.state === "done").length).toBe(completedJobs);
        expect(executions.reduce((total, execution) => total + execution.completedGpuH, 0)).toBeCloseTo(gpuHours, 9);
    }

    async expectRemainingWork(job: Job, gpuHours: number): Promise<void> {
        expect(this.runner?.job(job.id)?.remainingGpuH).toBeCloseTo(gpuHours, 9);
    }

    async expectSiteEnergy(arm: string, locationId: string, importedKWh: number, computeKWh: number, storedKWh: number): Promise<void> {
        expect(arm).toBe("selected");
        const meter = this.observation().meters.find(meter => meter.locationId === locationId);
        expect(meter).toBeDefined();
        expect(meter!.gridImportKWh).toBeCloseTo(importedKWh, 9);
        expect(meter!.computeKWh).toBeCloseTo(computeKWh, 9);
        expect(meter!.endingStoredKWh).toBeCloseTo(storedKWh, 9);
    }

    async expectExecutionCharges(job: Job, locationId: string, postedUsd: number, electricityUsd: number): Promise<void> {
        const tick = this.observation();
        expect(tick.executions.filter(execution => execution.jobId === job.id)
            .reduce((total, execution) => total + execution.postedChargeUsd, 0)).toBeCloseTo(postedUsd, 9);
        expect(tick.meters.find(meter => meter.locationId === locationId)?.electricityUsd).toBeCloseTo(electricityUsd, 9);
    }

    private requireSite(locationId: string): SiteSetup {
        const site = this.sites.get(locationId);
        if (!site) throw new Error("Supply the site before its storage or quote.");
        return site;
    }

    private observation(): TickObservation {
        if (!this.tick) throw new Error("Execute the selected slot before observing work or meters.");
        return this.tick;
    }
}

export const test = baseTest.extend("torus", () => new ExecutionScenario());
