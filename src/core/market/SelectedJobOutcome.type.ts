/** Number profile: JavaScript binary64. */
import type { Bid } from "./Bid.type.js";
export type SelectedJobOutcome = {
    selected: true;
    selectedBid: Bid;
    allocatedGpus: number;
    clearingUsdPerGpuHour: number;
    explanation: string;
};
