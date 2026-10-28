export type CostReport = {
    costBasis?: string;
    unavailableReason?: string;
    baselineModeledCostUsd?: number;
    selectedModeledCostUsd?: number;
    baselineElectricityUsd?: number;
    selectedElectricityUsd?: number;
};
