import type { GridObservation } from "./GridObservation.interface.js";
import type { BidForecast } from "../market/BidForecast.type.js";
export type GridContext = {
    observations: Array<GridObservation>;
    forecast: BidForecast;
};
