import type { ForecastPoint } from "./ForecastPoint.type.js";
export type Forecast = {
    source: string;
    scope: string;
    basis: string;
    unit: "gCO2/kWh" | "gCO2e/kWh" | "MW" | "kW";
    issuedAt?: string | undefined;
    retrievedAt: string;
    simulated: boolean;
    points: Array<ForecastPoint>;
};
