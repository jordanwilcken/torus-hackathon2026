import type { TimeWindow } from "../TimeWindow.type.js";
export interface GridObservation {
  regionId: string;
  metric: 'consumption-carbon-intensity' | 'demand' | 'generation' | 'interchange';
  value: number | null;
  unit: 'gCO2/kWh' | 'MW';
  window: TimeWindow;
  source: string;
  observedAt: string;
  simulated: boolean;
}
