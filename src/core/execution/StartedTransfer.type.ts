import type { TransferObservation } from "./TransferObservation.type.js";
export type StartedTransfer = {
    started: true;
    readyAt: string;
    evidence: TransferObservation;
    explanation: string;
};
