import type { SlotReference } from "../energy/SlotReference.type.js";
import type { SlotForecast } from "../energy/SlotForecast.type.js";
import type { EnergyUse } from "./EnergyUse.type.js";

/** One current-slot selection; Executor.accept still has to reserve it. */
export type Allocation = {
    jobId: string;
    slot: SlotReference;
    slotVersion: string;
    allocatedGpus: number;
    kWhPerGpuHour: number;
    requiredPowerKW: number;
    energy: Array<EnergyUse>;
    forecast: SlotForecast;
    postedUsdPerGpuHour: number;
    priceBasis: string;
};
