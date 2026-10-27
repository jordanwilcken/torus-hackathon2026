/** Number profile: JavaScript binary64. */
import type { SlotQuery } from "./SlotQuery.interface.js";
import type { SlotReference } from "./SlotReference.type.js";
import type { SlotSnapshot } from "./SlotSnapshot.type.js";
import type { SlotForecast } from "./SlotForecast.type.js";
export interface EnergyMap {
    /**
     * Unverified implementation obligation.
     * Discover candidate locations and time windows. A reference alone neither certifies feasibility nor reserves capacity.
     */
    findSlots(query: SlotQuery): Array<SlotReference>;
    /**
     * Unverified implementation obligation.
     * requires maximumAgeMinutes >= 0
     * Return a self-contained snapshot with source, version and observation time. asOf determines evidence freshness; the reference identifies the execution slot.
     * A current snapshot contains the matching slot, version and observation time. Power, energy, GPU cap, used GPUs and posted price are nonnegative; GPU counts are integral and usedGpus <= capGpus and the window has positive duration. Forecast projections are labeled and cannot be treated as firm future reservations.
     * Mark stale or unavailable evidence explicitly; consumers cannot present it as a confirmed current place to run. Energy estimates include known storage provenance and losses.
     */
    readSlot(reference: SlotReference, asOf: string, maximumAgeMinutes: number): SlotSnapshot;
    /**
     * Unverified implementation obligation.
     * Resolve the location and time window into available forecast evidence. Preserve each metric's source and timestamps separately from local slot freshness. The allocation retains a snapshot rather than a mutable reference.
     */
    readForecast(reference: SlotReference, asOf: string): SlotForecast;
}
