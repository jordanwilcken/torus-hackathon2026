import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SlotSnapshot } from "../SlotSnapshot.type.js";
import type { SiteEnergyAssessment, SiteEnergyConfiguration, SiteEnergyInput, SiteEnergyLedger,
    SiteEnergyLoad, SiteEnergyProjectionContext, SiteEnergyQuoteProvider, SiteEnergyReservation, SiteEnergyReservationResult,
    SiteEnergyState, SiteEnergyTick } from "./SiteEnergy.types.js";
import { simulateSiteInterval } from "./siteEnergyPhysics.js";
import { containsWindow, loadIdentity, validateConfiguration, validateInput, validateLoad, windowBounds, windowKey } from "./siteEnergyInputs.js";
import { createSiteEnergyProjection } from "./siteEnergyProjection.js";
import { createSiteEnergyReservations } from "./siteEnergyReservations.js";

/** Each arm owns one coordinator. Only successful commands commit inventory, time and revisions. */
export function createSiteEnergyLedger(configuration: SiteEnergyConfiguration, inputs: readonly SiteEnergyInput[],
    quote?: SiteEnergyQuoteProvider): SiteEnergyLedger {
    const config = structuredClone(configuration), readings = structuredClone([...inputs]);
    validateConfiguration(config);
    readings.forEach(validateInput);
    for (let index = 1; index < readings.length; index++)
        if (windowBounds(readings[index - 1].window)[1] !== windowBounds(readings[index].window)[0])
            throw new RangeError("Canonical input intervals must be supplied in contiguous chronological order.");
    let cursor = 0, revision = 0;
    let inventory = structuredClone(config.storage.initial);
    if (inventory.storedKWh === 0) inventory = { storedKWh: 0, carbonKg: 0, electricityUsd: 0 };
    const reservations = createSiteEnergyReservations();
    const publication = createSiteEnergyProjection(config, quote);
    const settled = new Map<string, { signature: string; result: SiteEnergyAssessment }>();
    // One revision captures readings, reservations, inventory and quotes. Keep only bounded request views.
    const published = new Map<string, SlotSnapshot[]>();
    const advanceRevision = (): void => { revision++; publication.invalidateQuotes(); published.clear(); };
    const version = (): string => `${config.locationId}:${revision}`;
    const state = (): SiteEnergyState => structuredClone({ version: version(), nextWindow: readings[cursor]?.window, inventory });
    const context = (): SiteEnergyProjectionContext => ({ readings, cursor, inventory, version: version(), reservations: reservations.loads() });
    const failure = (reason: string): SiteEnergyAssessment => ({ feasible: false, version: version(), meters: [], inventory: structuredClone(inventory), usage: {}, reason });

    return {
        state,
        assess: (plan: readonly SiteEnergyLoad[]): SiteEnergyAssessment => publication.assess(context(), plan),
        reserve(request: SiteEnergyReservation): SiteEnergyReservationResult {
            const reject = (reason: string): SiteEnergyReservationResult => ({ accepted: false, version: version(), reason });
            try {
                validateLoad(request.load);
                const retry = reservations.retry(request, version());
                if (retry) return retry;
                const input = readings[cursor];
                if (!input || !containsWindow(input.window, request.load.window) || input.evidence.projected || input.evidence.status !== "current" ||
                    Date.parse(input.evidence.observedAt) > windowBounds(input.window)[0])
                    return reject("Only a current, observed canonical slot can be reserved.");
                if (request.version !== version()) return reject("The slot version changed; read fresh availability.");
                const assessment = simulateSiteInterval(config, { input, inventory, loads: [...reservations.loads(), request.load] });
                if (!assessment.feasible) return reject(assessment.reason!);
                const captured = structuredClone(request);
                advanceRevision();
                const result = { accepted: true, version: version() };
                reservations.accept(captured, result);
                return structuredClone(result);
            } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                return reject(error.message);
            }
        },
        release(reservationId: string): boolean {
            const result = reservations.release(reservationId);
            if (result === "released") advanceRevision();
            return result !== "missing";
        },
        dispatch(tick: SiteEnergyTick): SiteEnergyAssessment {
            try {
                const tickKey = windowKey(tick.window);
                const signature = JSON.stringify(tick.loads.map(loadIdentity).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
                const prior = settled.get(tickKey);
                if (prior) return prior.signature === signature ? structuredClone(prior.result) : failure("A settled tick cannot be retried with changed loads.");
                const input = readings[cursor];
                if (!input || windowKey(input.window) !== tickKey) return failure("Dispatch must use the next canonical chronological tick.");
                if (input.evidence.projected || Date.parse(input.evidence.observedAt) > windowBounds(input.window)[0])
                    return failure("Projected or later-observed supply cannot settle this canonical tick.");
                const actual = reservations.actual(tick.loads);
                if (!actual) return failure("Actual loads must fit unique accepted reservations.");
                const result = simulateSiteInterval(config, { input, inventory, loads: actual });
                if (!result.feasible) return failure(result.reason!);
                inventory = result.inventory; cursor++; advanceRevision(); reservations.clear();
                const captured: SiteEnergyAssessment = { ...result, version: version() };
                settled.set(tickKey, { signature, result: structuredClone(captured) });
                return structuredClone(captured);
            } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                return failure(error.message);
            }
        },
        update(input: SiteEnergyInput): void {
            const captured = structuredClone(input);
            validateInput(captured);
            const index = readings.findIndex(reading => windowKey(reading.window) === windowKey(input.window));
            if (index < cursor || index < 0) throw new RangeError("Only unsettled canonical inputs can be updated.");
            const prior = readings[index];
            if (JSON.stringify(prior) === JSON.stringify(captured)) return;
            if (prior.evidence.version === captured.evidence.version || Date.parse(captured.evidence.observedAt) < Date.parse(prior.evidence.observedAt))
                throw new RangeError("Changed input requires a new version and a nondecreasing observation time.");
            readings[index] = captured; advanceRevision();
        },
        refreshPublication: advanceRevision,
        slots(locationId: string, window: TimeWindow): SlotSnapshot[] {
            const key = JSON.stringify([locationId, windowKey(window)]);
            if (!published.has(key)) {
                const snapshots = publication.slots(context(), { locationId, window });
                if (published.size >= 32) published.delete(published.keys().next().value!);
                published.set(key, snapshots);
            }
            return structuredClone(published.get(key)!);
        },
    };
}
