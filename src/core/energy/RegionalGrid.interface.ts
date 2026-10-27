import type { TimeWindow } from "../TimeWindow.type.js";
import type { GridContext } from "./GridContext.type.js";
export interface RegionalGrid {
    /**
     * Unverified implementation obligation.
     * Adapt regional observations and available forecasts, retaining metric, unit, period, source and evidence kind. EIA supplies regional context, not local compute capacity or permission to consume stored energy. Normalize hour-ending timestamps to UTC and use consumption/load operational CO2 including interchange for that accounting basis, not generation-weighted lifecycle factors. Day-ahead demand is not a carbon forecast; a separately named model is required to forecast carbon.
     */
    read(regionId: string, window: TimeWindow): GridContext;
}
