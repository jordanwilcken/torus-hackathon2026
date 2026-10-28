import type { TimeWindow } from "../../TimeWindow.type.js";
import type { EnergyMapSite } from "./EnergyMapSite.type.js";

/** Fixed lookup horizon and the sites available to this map. */
export type EnergyMapScope = {
    /** Overlapping slots retain their original windows and quantities. */
    window: TimeWindow;
    sites: readonly EnergyMapSite[];
};
