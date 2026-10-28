import type { SiteMeter } from "../../execution/SiteMeter.type.js";
import type { SiteEnergyBalanceResult, SiteEnergyCalculation, SiteEnergyConfiguration, SiteEnergyFlow,
    SiteEnergyPeriodCalculation, SiteEnergyUsage } from "./SiteEnergy.types.js";
import { prepareSitePeriods } from "./siteEnergyInputs.js";
import { accountSitePeriod, addKnown, combineUsage, emptyUsage } from "./siteEnergyAccounting.js";
import { batteryDelivery, curtailedSolar, energyForPeriod, requiredGridImport, solarCharging, storageAfterCharge,
    storageAfterDischarge, storageWithdrawal, surplusSolar, totalDemand, unmetDemand, usableStorage } from "./math/siteEnergy.generated.js";

/** Energy at one site — the executable sequence follows math/siteEnergy.math.md.
 * Each period has constant supply and active load. Energy is kWh, power is kW,
 * and time is hours. Battery delivery and charge input are measured at the site;
 * stored energy is measured inside the battery, on the other side of the losses.
 */
function balanceSitePeriod(config: SiteEnergyConfiguration, calculation: SiteEnergyPeriodCalculation): SiteEnergyBalanceResult {
    const { period, supply, storedKWh } = calculation;
    const { hours } = period;
    const { limits, efficiency } = config.storage;
    if (period.gpus > config.compute.capGpus) return { feasible: false, reason: "Concurrent loads exceed GPU capacity." };

    // 1. Integrate power over this period, then form one shared demand total.
    const solarKWh = energyForPeriod({ powerKW: supply.solarKW, durationHours: hours });
    const fixedLoadKWh = energyForPeriod({ powerKW: supply.fixedLoadKW, durationHours: hours });
    const computeKWh = energyForPeriod({ powerKW: period.gpus * config.compute.kWPerGpu, durationHours: hours });
    const demandKWh = totalDemand({ fixedKWh: fixedLoadKWh, computeKWh });
    const unmetKWh = unmetDemand({ demandKWh, solarKWh });

    // 2. Supply the deficit from usable storage, then the grid within its hard limit.
    const usableKWh = usableStorage({ storedKWh, protectedKWh: supply.protectedKWh });
    const batteryKWh = batteryDelivery({ unmetKWh, usableKWh, dischargeEfficiency: efficiency.discharge,
        dischargeLimitKWh: energyForPeriod({ powerKW: limits.dischargeKW, durationHours: hours }) });
    const requiredGridKWh = requiredGridImport({ unmetKWh, batteryKWh });
    const gridLimitKWh = energyForPeriod({ powerKW: supply.gridImportLimitKW, durationHours: hours });
    if (!withinPhysicalLimit(requiredGridKWh, gridLimitKWh))
        return { feasible: false, reason: "Active load exceeds import, discharge or available-energy limits." };
    const gridImportKWh = Math.min(requiredGridKWh, gridLimitKWh);

    // 3. Remove the delivered energy and its discharge loss from storage.
    const withdrawnKWh = storageWithdrawal({ usableKWh, batteryKWh, dischargeEfficiency: efficiency.discharge });
    const remainingKWh = storageAfterDischarge({ storedKWh, withdrawnKWh, protectedKWh: supply.protectedKWh });

    // 4. Store surplus solar within charging and capacity limits; curtail the rest.
    const surplusKWh = surplusSolar({ solarKWh, demandKWh });
    const chargeKWh = solarCharging({ surplusKWh, remainingKWh, capacityKWh: limits.capacityKWh,
        chargeEfficiency: efficiency.charge, chargeLimitKWh: energyForPeriod({ powerKW: limits.chargeKW, durationHours: hours }) });
    const endingStoredKWh = storageAfterCharge({ remainingKWh, chargeKWh,
        capacityKWh: limits.capacityKWh, chargeEfficiency: efficiency.charge });
    return { feasible: true, balance: {
        solarKWh, solarUsedKWh: Math.min(solarKWh, demandKWh), fixedLoadKWh, computeKWh, gridImportKWh,
        batteryDischargeKWh: batteryKWh, batteryChargeKWh: chargeKWh,
        curtailedKWh: curtailedSolar({ surplusKWh, chargeKWh }), withdrawnKWh,
        storedAfterDischargeKWh: remainingKWh, endingStoredKWh,
    } };
}

/** Absorb binary64 rounding only; accepted imports are still capped at the actual limit. */
function withinPhysicalLimit(value: number, limit: number): boolean {
    return Number.isFinite(value) && value <= limit + 8 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(limit));
}

/** Integrate a canonical interval without committing state. A failed period rejects the whole interval. */
export function simulateSiteInterval(config: SiteEnergyConfiguration, calculation: SiteEnergyCalculation): SiteEnergyFlow {
    const { input, loads } = calculation;
    const initial = structuredClone(calculation.inventory);
    let inventory = structuredClone(initial);
    const failure = (reason: string): SiteEnergyFlow => ({ feasible: false, meters: [], inventory: initial, usage: {}, reason });
    const supply = input.supply;
    if (!supply || input.evidence.status !== "current") return failure("Local supply is missing, stale or unavailable.");
    if (supply.protectedKWh > inventory.storedKWh) return failure("Protected reserve exceeds current stored energy.");
    const periods = prepareSitePeriods(input.window, loads);
    const usage: Record<string, SiteEnergyUsage> = Object.create(null);
    const meter: SiteMeter = {
        locationId: config.locationId, window: { ...input.window }, accountingBasis: config.accountingBasis,
        solarKWh: 0, gridImportKWh: 0, batteryChargeKWh: 0, batteryDischargeKWh: 0, curtailedKWh: 0,
        fixedLoadKWh: 0, computeKWh: 0, endingStoredKWh: inventory.storedKWh, carbonKg: 0, electricityUsd: 0,
    };
    for (const period of periods) {
        const result = balanceSitePeriod(config, { period, supply, storedKWh: inventory.storedKWh });
        if (!result.feasible) return failure(result.reason);
        const { balance } = result;
        const accounted = accountSitePeriod(input.accounting, inventory, { balance,
            loads: period.loads.map(load => ({ id: load.id,
                energyKWh: energyForPeriod({ powerKW: load.gpus * config.compute.kWPerGpu, durationHours: period.hours }) })),
        });
        inventory = accounted.inventory;
        for (const [id, supplied] of Object.entries(accounted.usage)) usage[id] = combineUsage(usage[id] ?? emptyUsage(), supplied);

        // Meters integrate site-boundary flows; source burdens are booked only when consumed.
        meter.solarKWh += balance.solarKWh;
        meter.gridImportKWh += balance.gridImportKWh;
        meter.batteryChargeKWh += balance.batteryChargeKWh;
        meter.batteryDischargeKWh += balance.batteryDischargeKWh;
        meter.curtailedKWh += balance.curtailedKWh;
        meter.fixedLoadKWh += balance.fixedLoadKWh;
        meter.computeKWh += balance.computeKWh;
        meter.endingStoredKWh = inventory.storedKWh;
        meter.endingStoredCarbonKg = inventory.carbonKg;
        meter.endingStoredElectricityUsd = inventory.electricityUsd;
        meter.carbonKg = addKnown(meter.carbonKg, accounted.consumed.carbonKg);
        meter.electricityUsd = addKnown(meter.electricityUsd, accounted.consumed.electricityUsd);
        const totals = [meter.solarKWh, meter.gridImportKWh, meter.batteryChargeKWh, meter.batteryDischargeKWh,
            meter.curtailedKWh, meter.fixedLoadKWh, meter.computeKWh, inventory.storedKWh,
            inventory.carbonKg, inventory.electricityUsd, meter.carbonKg, meter.electricityUsd];
        if (totals.some(value => value !== undefined && !Number.isFinite(value))) return failure("Energy or accounting calculation overflowed.");
    }
    return { feasible: true, meters: [meter], inventory, usage };
}
