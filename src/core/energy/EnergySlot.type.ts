/** Number profile: JavaScript binary64. */
import type { TimeWindow } from "../TimeWindow.type.js";
export type EnergySlot = {
    id: string;
    locationId: string;
    window: TimeWindow;
    availablePowerKW: number;
    availableEnergyKWh: number;
    capGpus: number;
    reserveUsdPerGpuHour: number;
};
