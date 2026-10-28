import type { SlotSnapshot } from "../SlotSnapshot.type.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { SiteEnergyAssessment, SiteEnergyConfiguration, SiteEnergyInput, SiteEnergyLedger,
    SiteEnergyLoad, SiteEnergyOffer, SiteEnergyQuote, SiteEnergyQuoteProvider, SiteEnergyReservation, SiteEnergyReservationResult,
    SiteEnergyState, SiteEnergyTick, SiteEnergyUsage } from "./SiteEnergy.types.js";
import { combineUsage, emptyUsage, simulateSiteInterval, validateConfiguration, validateInput, validateLoad, windowBounds } from "./siteEnergyPhysics.js";

/** Each simulation arm owns an instance. Solar -> usable battery -> grid; no grid charging or exports.
 * Inventory carries source burdens until consumed, including storage losses. Reads never settle work.
 * Future publications conservatively consume earlier full offers; they are conditional, not reservations.
 */
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
    const reservations = new Map<string, SiteEnergyReservation>();
    const accepted = new Map<string, { request: SiteEnergyReservation; result: SiteEnergyReservationResult; released: boolean }>();
    const settled = new Map<string, { signature: string; result: SiteEnergyAssessment }>();
    const quotes = new Map<string, SiteEnergyQuote | undefined>();
    const advanceRevision = (): void => { revision++; quotes.clear(); };
    const version = (): string => `${config.locationId}:${revision}`;
    const state = (): SiteEnergyState => structuredClone({ version: version(), nextWindow: readings[cursor]?.window, inventory });
    const failure = (reason: string): SiteEnergyAssessment => ({ feasible: false, version: version(), meters: [], inventory: structuredClone(inventory), usage: {}, reason });
    const currentLoads = (): SiteEnergyLoad[] => [...reservations.values()].map(request => request.load);
    const key = (window: TimeWindow): string => windowBounds(window).join("/");
    const normalized = (load: SiteEnergyLoad): readonly [string, number, number, number] => [load.id, load.gpus, ...windowBounds(load.window)];
    const sameLoad = (left: SiteEnergyLoad, right: SiteEnergyLoad): boolean => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
    const belongs = (load: SiteEnergyLoad, input: SiteEnergyInput): boolean => {
        const [from, to] = windowBounds(load.window), [start, end] = windowBounds(input.window);
        return from >= start && to <= end;
    };
    const evaluate = (plan: readonly SiteEnergyLoad[], until: number = readings.length): SiteEnergyAssessment => {
        try {
            const ids = new Set<string>();
            for (const load of plan) {
                validateLoad(load);
                if (ids.has(load.id)) return failure("Load identities must be unique.");
                ids.add(load.id);
                if (!readings.slice(cursor, until).some(input => belongs(load, input))) return failure("A load must fit one unsettled canonical interval.");
            }
            let projected = structuredClone(inventory);
            const meters: SiteEnergyAssessment["meters"] = [], usage: Record<string, SiteEnergyUsage> = Object.create(null);
            for (const input of readings.slice(cursor, until)) {
                const result = simulateSiteInterval(config, { input, inventory: projected, loads: plan.filter(load => belongs(load, input)) });
                if (!result.feasible) return failure(result.reason!);
                projected = result.inventory; meters.push(...result.meters);
                for (const [id, supplied] of Object.entries(result.usage)) usage[id] = combineUsage(usage[id] ?? emptyUsage(), supplied);
            }
            return { feasible: true, version: version(), meters, inventory: projected, usage };
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            return failure(error.message);
        }
    };
    const peakGpus = (loads: readonly SiteEnergyLoad[]): number => Math.max(0, ...loads.map(load => {
        const at = Date.parse(load.window.startAt);
        return loads.filter(other => Date.parse(other.window.startAt) <= at && at < Date.parse(other.window.endAt)).reduce((total, other) => total + other.gpus, 0);
    }));

    return {
        state,
        assess(plan: readonly SiteEnergyLoad[]): SiteEnergyAssessment {
            return structuredClone(evaluate([...currentLoads(), ...structuredClone(plan)]));
        },
        reserve(request: SiteEnergyReservation): SiteEnergyReservationResult {
            const reject = (reason: string): SiteEnergyReservationResult => ({ accepted: false, version: version(), reason });
            try {
                validateLoad(request.load);
                const prior = accepted.get(request.load.id);
                if (prior) return !prior.released && prior.request.version === request.version && sameLoad(prior.request.load, request.load)
                    ? structuredClone(prior.result) : reject("Reservation identity was already used with different or released inputs.");
                const input = readings[cursor];
                if (!input || !belongs(request.load, input) || input.evidence.projected || input.evidence.status !== "current" ||
                    Date.parse(input.evidence.observedAt) > windowBounds(input.window)[0])
                    return reject("Only a current, observed canonical slot can be reserved.");
                if (request.version !== version()) return reject("The slot version changed; read fresh availability.");
                const assessment = simulateSiteInterval(config, { input, inventory, loads: [...currentLoads(), request.load] });
                if (!assessment.feasible) return reject(assessment.reason!);
                const captured = structuredClone(request);
                reservations.set(request.load.id, captured); advanceRevision();
                const result = { accepted: true, version: version() };
                accepted.set(request.load.id, { request: captured, result, released: false });
                return structuredClone(result);
            } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                return reject(error.message);
            }
        },
        release(reservationId: string): boolean {
            const prior = accepted.get(reservationId);
            if (!prior) return false;
            if (prior.released) return true;
            if (!reservations.delete(reservationId)) return false;
            prior.released = true; advanceRevision();
            return true;
        },
        dispatch(tick: SiteEnergyTick): SiteEnergyAssessment {
            try {
                const tickKey = key(tick.window);
                const signature = JSON.stringify(tick.loads.map(normalized).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
                const prior = settled.get(tickKey);
                if (prior) return prior.signature === signature ? structuredClone(prior.result) : failure("A settled tick cannot be retried with changed loads.");
                const input = readings[cursor];
                if (!input || key(input.window) !== tickKey) return failure("Dispatch must use the next canonical chronological tick.");
                if (input.evidence.projected || Date.parse(input.evidence.observedAt) > windowBounds(input.window)[0])
                    return failure("Projected or later-observed supply cannot settle this canonical tick.");
                const actual = new Map<string, SiteEnergyLoad>();
                for (const load of tick.loads) {
                    validateLoad(load);
                    const reservation = reservations.get(load.id)?.load;
                    if (actual.has(load.id) || !reservation || load.gpus > reservation.gpus || !belongs(load, { ...input, window: reservation.window }))
                        return failure("Actual loads must fit unique accepted reservations.");
                    actual.set(load.id, structuredClone(load));
                }
                const ordered = currentLoads().flatMap(load => actual.has(load.id) ? [actual.get(load.id)!] : []);
                const result = simulateSiteInterval(config, { input, inventory, loads: ordered });
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
            const index = readings.findIndex(reading => key(reading.window) === key(input.window));
            if (index < cursor || index < 0) throw new RangeError("Only unsettled canonical inputs can be updated.");
            const prior = readings[index];
            if (JSON.stringify(prior) === JSON.stringify(captured)) return;
            if (prior.evidence.version === captured.evidence.version || Date.parse(captured.evidence.observedAt) < Date.parse(prior.evidence.observedAt))
                throw new RangeError("Changed input requires a new version and a nondecreasing observation time.");
            readings[index] = captured; advanceRevision();
        },
        refreshPublication: advanceRevision,
        slots(locationId: string, requested: TimeWindow): SlotSnapshot[] {
            const [from, to] = windowBounds(requested);
            if (locationId !== config.locationId) return [];
            const hypothetical = currentLoads();
            return readings.slice(cursor).flatMap((input, offset) => {
                const [start, end] = windowBounds(input.window);
                const base: SlotSnapshot = {
                    status: "unavailable", source: input.evidence.source, observedAt: input.evidence.observedAt,
                    version: version(), projected: offset > 0 || input.evidence.projected, simulated: true,
                };
                if (start >= to) return [];
                const baseline = evaluate(hypothetical, cursor + offset + 1);
                if (!baseline.feasible || !input.supply || input.evidence.status !== "current") return end > from ? [base] : [];
                const priorStored = offset === 0 ? inventory.storedKWh : baseline.meters[offset - 1].endingStoredKWh;
                const committed = hypothetical.filter(load => belongs(load, input));
                const usedGpus = peakGpus(committed);
                const batteryKW = priorStored > input.supply.protectedKWh ? config.storage.limits.dischargeKW : 0;
                const headroom = Math.max(0, input.supply.solarKW + input.supply.gridImportLimitKW + batteryKW - input.supply.fixedLoadKW - usedGpus * config.compute.kWPerGpu);
                const gpus = Math.max(0, Math.min(config.compute.capGpus - usedGpus, Math.floor(headroom / config.compute.kWPerGpu)));
                let duration = 0, upper = end - start;
                let id = `ledger-offer:${offset}`;
                while (hypothetical.some(load => load.id === id)) id += ":";
                const candidate = (milliseconds: number): SiteEnergyLoad => ({ id, gpus, window: { startAt: input.window.startAt, endAt: new Date(start + milliseconds).toISOString() } });
                if (gpus > 0) for (let iteration = 0; iteration < 54; iteration++) {
                    const middle = Math.floor((duration + upper + 1) / 2);
                    if (middle <= duration) break;
                    if (evaluate([...hypothetical, candidate(middle)], cursor + offset + 1).feasible) duration = middle;
                    else upper = middle - 1;
                }
                const proposed = duration > 0 && gpus > 0 ? candidate(duration) : undefined;
                const assessed = proposed ? evaluate([...hypothetical, proposed], cursor + offset + 1) : baseline;
                const offer: SiteEnergyOffer = {
                    version: version(), window: { ...input.window }, capGpus: gpus + usedGpus, usedGpus,
                    availablePowerKW: duration > 0 ? gpus * config.compute.kWPerGpu : 0,
                    availableEnergyKWh: gpus * config.compute.kWPerGpu * duration / 3_600_000,
                    supply: proposed ? assessed.usage[id] ?? emptyUsage() : emptyUsage(),
                };
                if (proposed) hypothetical.push(proposed);
                if (end <= from) return [];
                const quoteKey = key(input.window);
                if (!quotes.has(quoteKey)) quotes.set(quoteKey, structuredClone(quote?.(structuredClone(offer))));
                const price = quotes.get(quoteKey);
                if (!price || price.version !== offer.version || !price.basis || !Number.isFinite(price.usdPerGpuHour) || price.usdPerGpuHour < 0) return [base];
                return [{ ...base, status: "current" as const,
                    siteEnergy: { solarKWh: input.supply.solarKW * (end - start) / 3_600_000, storedKWh: priorStored,
                        protectedKWh: input.supply.protectedKWh, capacityKWh: config.storage.limits.capacityKWh, gridImportLimitKW: input.supply.gridImportLimitKW },
                    slot: { id: `${config.locationId}@${input.window.startAt}`, locationId: config.locationId, window: { ...input.window },
                        availablePowerKW: offer.availablePowerKW, availableEnergyKWh: offer.availableEnergyKWh,
                        capGpus: offer.capGpus, usedGpus: offer.usedGpus, postedUsdPerGpuHour: price.usdPerGpuHour, priceBasis: price.basis },
                }];
            });
        },
    };
}
