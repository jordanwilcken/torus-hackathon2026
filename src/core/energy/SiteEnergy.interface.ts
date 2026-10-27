import type { TimeWindow } from "../TimeWindow.type.js";
import type { SlotSnapshot } from "./SlotSnapshot.type.js";
export interface SiteEnergy {
    /**
     * Unverified implementation obligation.
     * Adapt site energy evidence into versioned slots after reserves and utility commitments. The hackathon uses labeled simulated site inputs without Lasso access. Unknown capacity is unavailable, not fabricated usable capacity; this read operation does not dispatch assets. A future real adapter requires authorized telemetry.
     * Use the shared site-energy ledger when projecting availability across hours. Future caps depend on chronological SOC, efficiencies, power limits, fixed load and forecasts; they cannot each spend the same stored energy. Immediate reserves above current SOC are infeasible; a future reserve requires a feasible charging path. Retain separate local and regional evidence freshness.
     */
    slots(locationId: string, window: TimeWindow): Array<SlotSnapshot>;
}
