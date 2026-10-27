import type { TimeWindow } from "../TimeWindow.type.js";
export type EnergySlot = {
    id: string;
    locationId: string;
    window: TimeWindow;
    /** Remaining discretionary compute supply after fixed load, reserves and commitments. */
    availablePowerKW: number;
    availableEnergyKWh: number;
    /** Total admissible GPU count and the portion already reserved in this slot. */
    capGpus: number;
    usedGpus: number;
    /** Modeled energy + carbon rate across remaining posted capacity, refreshed as its mix changes.
     * Not an observed utility tariff or a claim about the first GPU-hour's marginal cost. */
    postedUsdPerGpuHour: number;
    priceBasis: string;
};
