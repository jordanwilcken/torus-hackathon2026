import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SiteEnergy } from "../SiteEnergy.interface.js";
import type { RegionalGrid } from "../RegionalGrid.interface.js";

/** Associates a compute location with its regional evidence and supported profile. */
export type EnergyMapSite = {
    locationId: string;
    regionId: string;
    computeProfile: string;
};

/** Fixed lookup horizon and the sites available to this map. */
export type EnergyMapScope = {
    /** Overlapping slots retain their original windows and quantities. */
    window: TimeWindow;
    sites: readonly EnergyMapSite[];
};

/** Replaceable providers of local availability and regional forecast evidence. */
export type EnergyMapProviders = {
    siteEnergy: SiteEnergy;
    regionalGrid: RegionalGrid;
};
