/** Raw totals only; ReportableJob derives differences after checking comparability. */
export type CostReport = {
    costBasis?: string;
    unavailableReason?: string;
    baselineModeledCostUsd?: number;
    selectedModeledCostUsd?: number;
    baselineElectricityUsd?: number;
    selectedElectricityUsd?: number;
};
