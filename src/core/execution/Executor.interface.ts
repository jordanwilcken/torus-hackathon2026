import type { SelectedJobOutcome } from "../market/SelectedJobOutcome.type.js";
import type { TimeWindow } from "../TimeWindow.type.js";
import type { TickObservation } from "./TickObservation.type.js";
import type { Job } from "../jobs/Job.type.js";
import type { TransferOutcome } from "./TransferOutcome.type.js";
export interface Executor {
    /**
     * Unverified implementation obligation.
     * Revalidate the awarded quantity and price, source revision, job readiness, budget and current compute/energy/utility limits. Atomically reserve only the current slot; competing awards cannot spend the same GPU-hours or stored kWh. Return false without reservation on failure so the caller can re-quote.
     * Accepting the same job/slot award again cannot duplicate reservation or payment. Acceptance alone completes no work. This executor controls only the labeled simulation, not real Torus equipment or clusters.
     */
    accept(award: SelectedJobOutcome): boolean;
    /**
     * Unverified implementation obligation.
     * Advance one simulation tick. Ready jobs with accepted awards enter running, including previously paused jobs. Actual work is min(remaining GPU-hours, allocated GPUs times tick hours). Compute kWh equals that work times kWhPerGpuHour; market payment equals that work times clearing USD per GPU-hour. Jobs remaining moving, paused, done or missed complete no GPU work. Stop unfinished jobs at their deadline.
     * Use canonical, chronological ticks with positive duration. An exact retry returns the previous observation without advancing any site SOC, charging fixed load or repeating work, energy, money or transfers, including at idle sites. Reject overlapping or out-of-order windows without mutation. Recheck hard limits and budget before execution; unusable allocations pause or fail visibly rather than bypassing constraints.
     * Emit execution observations and whole-site meters, including idle sites. Enforce solar plus grid import plus discharge equals fixed load plus compute plus charge plus curtailed energy. SOC changes by charge efficiency times charged kWh minus discharged kWh divided by discharge efficiency. All bus flows are nonnegative and bounded by their kW limits times duration; reserve is no greater than SOC and SOC no greater than capacity.
     * Count fixed/inflexible load and PUE once. Use the same declared dispatch policy in both comparison arms; no grid charging, exports or simultaneous charging/discharging in the initial simulation. If fixed load or an immediate reserve cannot be met, return feasible false and no claimed savings; never invent supply or SOC.
     * Imported operational carbon kg equals imported kWh times realized gCO2 per kWh divided by 1000; electricity USD equals imported kWh times USD per MWh divided by 1000. Do not count stored electricity again on discharge. Unknown carbon/cost stays unavailable. Market payments remain separate from electricity expenditure.
     */
    tick(window: TimeWindow): TickObservation;
    /**
     * Unverified implementation obligation.
     * Evaluate the modeled transfer before destination bidding. Require an allowed destination, budget for transfer and time for transfer plus minimum remaining execution before the deadline; check eligible capacity without promising future auction awards. Compare estimated carbon savings with transfer carbon on a declared accounting boundary, not with transfer kWh.
     * An accepted move enters moving, records destination and ready time, and accounts for transfer cost/energy once without an execution award. Transfer kWh is dataGB times kWhPerGB; transfer hours is dataGB divided by bandwidthGBPerHour. Round readiness up to the next execution tick. On arrival update location; the job must bid again.
     * Return a stable transfer observation for the reporter, separating energy/carbon, electricity cost and modeled job charge. The initial simulation books the declared transfer energy and charge at transfer start on its stated accounting boundary; zero-duration transfers may complete immediately. A retry returns the same observation without charging again. Rejection has no observation or transfer effects.
     */
    move(job: Job, destination: string, startsAt: string): TransferOutcome;
}
