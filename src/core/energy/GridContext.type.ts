import type { GridObservation } from "./GridObservation.interface.js";
import type { SlotForecast } from "./SlotForecast.type.js";
export type GridContext = {
    observations: Array<GridObservation>;
    forecast: SlotForecast;
};
