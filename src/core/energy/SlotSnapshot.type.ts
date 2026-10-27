import type { EnergySlot } from "./EnergySlot.type.js";
export type SlotSnapshot = {
    status: "current" | "stale" | "unavailable";
    slot?: EnergySlot | undefined;
    source: string;
    version?: string | undefined;
    observedAt?: string | undefined;
    projected: boolean;
    simulated: boolean;
};
