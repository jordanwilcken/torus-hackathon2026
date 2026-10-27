import type { SelectedJobOutcome } from "../scheduling/JobOutcome.type.js";
import type { TimeWindow } from "../TimeWindow.type.js";
import type { TickObservation } from "./TickObservation.type.js";
import type { Job } from "../jobs/Job.type.js";
import type { TransferOutcome } from "./TransferOutcome.type.js";
export interface Executor {
    /**
     * Revalidate allocation quantity, posted price/basis, slot version, job readiness and
     * current compute/energy/utility limits. Atomically reserve only the current slot.
     * Competing selections cannot spend the same GPU capacity or stored kWh.
     * Return false without mutation on failure so the caller can read fresh slots.
     * Accepting the same job/slot selection again cannot duplicate reservations or charges.
     * Acceptance completes no work. This controls a labeled simulation, not real equipment.
     */
    accept(selection: SelectedJobOutcome): boolean;
    /**
     * Execute actual work = min(remaining GPU-hours, allocated GPUs * available tick hours).
     * Use only the interval after readiness and before the deadline. Compute kWh = actual
     * work * kWhPerGpuHour; posted charge = actual work * posted USD/GPU-hour.
     * Moving, paused, done or missed jobs complete no work; unfinished jobs stop at deadline.
     *
     * Require canonical chronological ticks of positive duration. An exact retry returns
     * the previous observation without advancing SOC or duplicating work, fixed/idle load,
     * energy, money or transfers. Reject overlapping/out-of-order ticks without mutation.
     * Recheck hard limits; an urgent job cannot bypass a utility cap or protected reserve.
     *
     * Meter every site, including idle sites. Solar + grid import + discharge =
     * fixed load + compute + charge + curtailment. SOC changes by charge efficiency *
     * charged kWh minus discharged kWh / discharge efficiency. All flows are nonnegative,
     * bounded by kW limits * hours; protected reserve <= SOC <= storage capacity.
     * Count fixed load and PUE once. Both comparison arms use the same dispatch policy;
     * initially no grid charging, exports or simultaneous charging/discharging.
     * If fixed load or an immediate reserve cannot be met, return feasible false;
     * never invent supply, SOC or claimed savings.
     *
     * Account carbon on the declared basis using realized evidence, not the planning
     * forecast. Imported kg = imported kWh * declared intensity / 1000; electricity USD =
     * imported kWh * USD/MWh / 1000. Include local/initial stored-energy provenance on
     * that same basis, without double counting discharge. Unknown carbon/cost stays
     * unavailable. Posted scheduling charges are distinct from electricity expenditure.
     */
    tick(window: TimeWindow): TickObservation;
    /**
     * Check allowed destination, transfer time + minimum remaining execution before
     * deadline, maxGpus and eligible capacity. A necessary feasibility check is not a
     * promise of future capacity. Include transfer cost and carbon on the same accounting
     * boundary when comparing places/times; do not compare carbon kg with energy kWh.
     *
     * An accepted move enters moving, records destination and readyAt, and accounts
     * transfer effects once. kWh = dataGB * kWhPerGB; hours = dataGB / bandwidthGBPerHour.
     * Round readiness up to the next execution tick. On arrival update location and
     * request a fresh slot. Remote execution cannot start before arrival.
     * Return a stable transfer observation separating energy/carbon, electricity cost
     * and modeled charge. Book declared effects at transfer start; zero-duration transfers
     * may arrive immediately. Retrying is idempotent; rejection has no effects.
     */
    move(job: Job, destination: string, startsAt: string): TransferOutcome;
}
