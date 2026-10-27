import type { GridObservation } from "./GridObservation.type.js";
import type { BidForecast } from "../market/BidForecast.type.js";
export type GridContext = {
    observations: Array<GridObservation>;
    forecast: BidForecast;
};
