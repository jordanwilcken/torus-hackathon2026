import type { SiteEnergy } from "../SiteEnergy.interface.js";
import type { RegionalGrid } from "../RegionalGrid.interface.js";

/** Replaceable providers of local availability and regional forecast evidence. */
export type EnergyMapProviders = {
    siteEnergy: SiteEnergy;
    regionalGrid: RegionalGrid;
};
