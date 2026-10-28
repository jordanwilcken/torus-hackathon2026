import { describe, expect, it } from "vitest";
import * as time from "../../../../src/core/execution/runner/math/time.generated.js";
import * as work from "../../../../src/core/execution/runner/math/execution.generated.js";
import * as transfer from "../../../../src/core/execution/runner/math/transfer.generated.js";
import { near } from "../../../../src/core/execution/runner/executionTime.js";

describe("Markdown-authored executor numerical boundaries", () => {
    it("divides large work and data quantities before converting hours to milliseconds", () => {
        const workHours = work.requiredHours({ remainingGpuH: 1e308, gpus: 1e308 });
        const transferHours = transfer.transferHours({ dataGB: 1e308, bandwidthGBPerHour: 1e308 });

        expect(time.millisecondsForHours({ durationHours: workHours })).toBe(3_600_000);
        expect(time.millisecondsForHours({ durationHours: transferHours })).toBe(3_600_000);
    });

    it("preserves timestamp precision before rounding arrival to the grid", () => {
        // This sub-millisecond duration is below binary64 precision at this epoch.
        const arrival = time.timeAfter({ start: 1_800_000_000_000, durationMs: 0.00001 });

        expect(transfer.gridReadyTime({ origin: 1_800_000_000_000, arrival, tickMs: 3_600_000 }))
            .toBe(1_800_000_000_000);
    });

    it("keeps actual source energy grouped in its existing settlement order", () => {
        const directKWh = work.directComputeEnergy({ solarKWh: 1e16, gridKWh: 1 });

        expect(work.totalComputeEnergy({ directKWh, batteryKWh: 1 })).toBe(1e16);
    });

    it("retains overflow rejection when accounting products precede unit conversion", () => {
        expect(transfer.carbonKilograms({ energyKWh: 1e308, gramsPerKWh: 1000 })).toBe(Infinity);
        expect(transfer.electricityDollars({ energyKWh: 1e308, usdPerMWh: 1000 })).toBe(Infinity);
    });

    it("snaps only roundoff-sized GPU deficits and never treats nonfinite values as near", () => {
        expect(transfer.wholePowerGpus({ powerGpus: 2.9999999999999996 })).toBe(3);
        expect(transfer.wholePowerGpus({ powerGpus: 2.999999999999 })).toBe(2);
        expect(near(0.30000000000000004, 0.3)).toBe(true);
        expect(near(Infinity, Infinity)).toBe(false);
        expect(near(NaN, 0)).toBe(false);
    });
});
