import type { TimeWindow } from "../TimeWindow.type.js";
export interface SlotQuery {
  window: TimeWindow;
  asOf: string;
  locations?: readonly string[];
  computeProfile?: string;
}
