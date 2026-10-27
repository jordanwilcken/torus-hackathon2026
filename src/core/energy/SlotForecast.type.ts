import type { Forecast } from "./Forecast.type.js";
export type SlotForecast = {
    carbon?: Forecast | undefined;
    demand?: Forecast | undefined;
    solar?: Forecast | undefined;
};
