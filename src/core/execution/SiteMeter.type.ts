/** Number profile: JavaScript binary64. */
import type { TimeWindow } from "../TimeWindow.type.js";
export type SiteMeter = {
    locationId: string;
    window: TimeWindow;
    solarKWh: number;
    gridImportKWh: number;
    batteryChargeKWh: number;
    batteryDischargeKWh: number;
    curtailedKWh: number;
    fixedLoadKWh: number;
    computeKWh: number;
    endingStoredKWh: number;
    /** Acquisition burdens retained in storage, not included in consumed totals. */
    endingStoredCarbonKg?: number | undefined;
    endingStoredElectricityUsd?: number | undefined;
    accountingBasis: string;
    carbonKg?: number | undefined;
    electricityUsd?: number | undefined;
};
