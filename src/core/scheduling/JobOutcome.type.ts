import type { Allocation } from "./Allocation.type.js";
export type SelectedJobOutcome = {
    selected: true;
    allocation: Allocation;
    explanation: string;
};

/** A proposed move, not an allocation or receipt. The executor must validate and start it. */
export type TransferPlan = {
    destination: string;
    startsAt: string;
    readyAt: string;
    estimatedCostUsd: number;
};

export type UnselectedJobOutcome = {
    selected: false;
    transfer?: TransferPlan;
    explanation: string;
};

export type JobOutcome = SelectedJobOutcome | UnselectedJobOutcome;
