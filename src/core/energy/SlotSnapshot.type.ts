import type { EnergySlot } from "./EnergySlot.type.js";
export type SlotSnapshot = {
    status: "current" | "stale" | "unavailable";
    slot?: EnergySlot | undefined;
    source: string;
    /** Optional map metadata accompanying this location's reading. */
    location?: { name: string; latitude: number; longitude: number; regionId: string };
    version?: string | undefined;
    observedAt?: string | undefined;
    projected: boolean;
    simulated: boolean;
};
