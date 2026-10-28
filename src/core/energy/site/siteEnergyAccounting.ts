import type { EnergyInventory, SiteEnergyAccountedPeriod, SiteEnergyConsumption, SiteEnergyInput, SiteEnergyUsage } from "./SiteEnergy.types.js";

/** Carbon and cost remain independently unknown; zero consumption always contributes zero. */
export function addKnown(left: number | undefined, right: number | undefined): number | undefined {
    return left === undefined || right === undefined ? undefined : left + right;
}

function burden(quantity: number, rate: number | undefined): number | undefined {
    return quantity === 0 ? 0 : rate === undefined ? undefined : quantity * rate;
}

function perKWh(ratePerThousand: number | undefined): number | undefined {
    return ratePerThousand === undefined ? undefined : ratePerThousand / 1000;
}

function retained(storedKWh: number, before: number | undefined, consumed: number | undefined): number | undefined {
    return storedKWh === 0 ? 0 : before === undefined ? undefined : before - (consumed ?? 0);
}

export function emptyUsage(): SiteEnergyUsage {
    return { solarKWh: 0, batteryKWh: 0, gridKWh: 0, carbonKg: 0, electricityUsd: 0 };
}

export function combineUsage(left: SiteEnergyUsage, right: SiteEnergyUsage): SiteEnergyUsage {
    return {
        solarKWh: left.solarKWh + right.solarKWh,
        batteryKWh: left.batteryKWh + right.batteryKWh,
        gridKWh: left.gridKWh + right.gridKWh,
        carbonKg: addKnown(left.carbonKg, right.carbonKg),
        electricityUsd: addKnown(left.electricityUsd, right.electricityUsd),
    };
}

/** Attribute a completed physical balance; this component cannot create energy or commit ledger state.
 * Acquisition burdens follow withdrawn storage, including losses. See math/siteEnergy.math.md.
 */
export function accountSitePeriod(rates: SiteEnergyInput["accounting"], before: EnergyInventory,
    consumption: SiteEnergyConsumption): SiteEnergyAccountedPeriod {
    const { balance, loads } = consumption;
    const fractionWithdrawn = before.storedKWh > 0 ? balance.withdrawnKWh / before.storedKWh : 0;
    const batteryCarbon = burden(fractionWithdrawn, before.carbonKg);
    const batteryCost = burden(fractionWithdrawn, before.electricityUsd);
    const solarCarbonRate = perKWh(rates.solarCarbonGPerKWh), gridCarbonRate = perKWh(rates.gridCarbonGPerKWh);
    const solarCostRate = perKWh(rates.solarUsdPerMWh), gridCostRate = perKWh(rates.gridUsdPerMWh);
    let remainingSolar = balance.solarUsedKWh;
    let remainingBattery = balance.batteryDischargeKWh;
    let remainingGrid = balance.gridImportKWh;

    // Consume bounded source pools in order: fixed load, accepted reservations, proposed work.
    const consume = (demandKWh: number): SiteEnergyUsage => {
        const solarKWh = Math.min(demandKWh, remainingSolar);
        remainingSolar -= solarKWh;
        const batteryKWh = Math.min(demandKWh - solarKWh, remainingBattery);
        remainingBattery -= batteryKWh;
        const gridKWh = Math.min(Math.max(0, demandKWh - solarKWh - batteryKWh), remainingGrid);
        remainingGrid -= gridKWh;
        const batteryShare = balance.batteryDischargeKWh === 0 ? 0 : batteryKWh / balance.batteryDischargeKWh;
        return {
            solarKWh, batteryKWh, gridKWh,
            carbonKg: addKnown(addKnown(burden(solarKWh, solarCarbonRate), burden(gridKWh, gridCarbonRate)), burden(batteryShare, batteryCarbon)),
            electricityUsd: addKnown(addKnown(burden(solarKWh, solarCostRate), burden(gridKWh, gridCostRate)), burden(batteryShare, batteryCost)),
        };
    };
    let consumed = consume(balance.fixedLoadKWh);
    const usage: Record<string, SiteEnergyUsage> = Object.create(null);
    for (const load of loads) {
        const supplied = consume(load.energyKWh);
        usage[load.id] = combineUsage(usage[load.id] ?? emptyUsage(), supplied);
        consumed = combineUsage(consumed, supplied);
    }

    // Charging is an acquisition. Its carbon and cost stay in storage until later consumption.
    const inventory: EnergyInventory = {
        storedKWh: balance.endingStoredKWh,
        carbonKg: addKnown(retained(balance.storedAfterDischargeKWh, before.carbonKg, batteryCarbon), burden(balance.batteryChargeKWh, solarCarbonRate)),
        electricityUsd: addKnown(retained(balance.storedAfterDischargeKWh, before.electricityUsd, batteryCost), burden(balance.batteryChargeKWh, solarCostRate)),
    };
    return { inventory, consumed, usage };
}
