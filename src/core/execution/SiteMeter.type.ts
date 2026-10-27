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
    operationalCarbonKg?: number | undefined;
    electricityUsd?: number | undefined;
};
