import type { TimeWindow } from "../TimeWindow.type.js";
export interface GridObservation {
  regionId: string;
  metric: 'generation-carbon-intensity' | 'consumption-carbon-intensity' | 'demand' | 'generation' | 'interchange';
  value: number | null;
  unit: 'gCO2/kWh' | 'gCO2e/kWh' | 'MW';
  window: TimeWindow;
  source: string;
  basis: string;
  observedAt: string;
  simulated: boolean;
}
