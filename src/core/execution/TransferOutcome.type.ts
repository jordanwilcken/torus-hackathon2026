import type { TransferObservation } from "./TransferObservation.type.js";
export type StartedTransfer = {
    started: true;
    readyAt: string;
    evidence: TransferObservation;
    explanation: string;
};

export type RejectedTransfer = {
    started: false;
    explanation: string;
};

export type TransferOutcome = StartedTransfer | RejectedTransfer;
