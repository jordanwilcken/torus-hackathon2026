import type { Allocation } from "./Allocation.type.js";
export type SelectedJobOutcome = {
    selected: true;
    allocation: Allocation;
    explanation: string;
};

export type UnselectedJobOutcome = {
    selected: false;
    explanation: string;
};

export type JobOutcome = SelectedJobOutcome | UnselectedJobOutcome;
