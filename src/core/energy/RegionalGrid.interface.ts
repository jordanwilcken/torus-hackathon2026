import type { TimeWindow } from "../TimeWindow.type.js";
import type { GridContext } from "./GridContext.type.js";
export interface RegionalGrid {
    /**
     * Adapt regional observations and forecasts with metric, basis, unit, period and source.
     * Begin with Utah/PacifiCorp East (PACE). EIA supplies regional context, not local
     * compute capacity, feeder congestion or permission to consume stored energy.
     * Normalize hour-ending timestamps to UTC. Fuel-generation factors yield a labeled
     * generation-weighted lifecycle CO2e proxy, not consumption or marginal emissions.
     * A consumption-based operational estimate requires its own consistent data/model,
     * including interchange. Do not silently mix those accounting bases.
     * Day-ahead demand is not a carbon forecast; identify the separate forecasting model.
     */
    read(regionId: string, window: TimeWindow): GridContext;
}
