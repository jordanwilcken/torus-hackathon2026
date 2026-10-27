/** Number profile: JavaScript binary64. */
import type { SlotReference } from "../energy/SlotReference.type.js";
import type { EnergyUse } from "./EnergyUse.type.js";
import type { BidForecast } from "./BidForecast.type.js";
export type Bid = {
    id: string;
    jobId: string;
    slot: SlotReference;
    slotVersion: string;
    quotedGpus: number;
    kWhPerGpuHour: number;
    requiredPowerKW: number;
    energy: Array<EnergyUse>;
    forecast: BidForecast;
};
