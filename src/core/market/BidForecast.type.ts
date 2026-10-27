import type { Forecast } from "../energy/Forecast.type.js";
export type BidForecast = {
    carbon?: Forecast | undefined;
    demand?: Forecast | undefined;
    solar?: Forecast | undefined;
};
