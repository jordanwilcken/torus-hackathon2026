/** Number profile: JavaScript binary64. */
import type { TimeWindow } from "../TimeWindow.type.js";
export type TransferObservation = {
    id: string;
    jobId: string;
    fromLocation: string;
    toLocation: string;
    window: TimeWindow;
    energyKWh: number;
    accountingBasis: string;
    carbonKg?: number | undefined;
    electricityUsd?: number | undefined;
    jobChargeUsd: number;
};
