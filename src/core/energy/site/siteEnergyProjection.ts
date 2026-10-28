import type { SlotSnapshot } from "../SlotSnapshot.type.js";
import type { SiteEnergyAssessment, SiteEnergyConfiguration, SiteEnergyLoad, SiteEnergyOffer, SiteEnergyProjection,
    SiteEnergyProjectionContext, SiteEnergyPublicationRequest, SiteEnergyQuote, SiteEnergyQuoteProvider, SiteEnergyUsage } from "./SiteEnergy.types.js";
import { combineUsage, emptyUsage } from "./siteEnergyAccounting.js";
import { containsWindow, validateLoad, windowBounds, windowKey } from "./siteEnergyInputs.js";
import { simulateSiteInterval } from "./siteEnergyPhysics.js";

/** Copied chronological rollouts and conservative offers; publishing never settles work. */
export function createSiteEnergyProjection(config: SiteEnergyConfiguration, quote?: SiteEnergyQuoteProvider): SiteEnergyProjection {
    const quotes = new Map<string, SiteEnergyQuote | undefined>();
    const evaluate = (context: SiteEnergyProjectionContext, plan: readonly SiteEnergyLoad[], until: number = context.readings.length): SiteEnergyAssessment => {
        try {
            const inputs = context.readings.slice(context.cursor, until), ids = new Set<string>();
            for (const load of plan) {
                validateLoad(load);
                if (ids.has(load.id)) return failure(context, "Load identities must be unique.");
                ids.add(load.id);
                if (!inputs.some(input => containsWindow(input.window, load.window))) return failure(context, "A load must fit one unsettled canonical interval.");
            }
            let inventory = structuredClone(context.inventory);
            const meters: SiteEnergyAssessment["meters"] = [], usage: Record<string, SiteEnergyUsage> = Object.create(null);
            for (const input of inputs) {
                const result = simulateSiteInterval(config, { input, inventory, loads: plan.filter(load => containsWindow(input.window, load.window)) });
                if (!result.feasible) return failure(context, result.reason!);
                inventory = result.inventory;
                meters.push(...result.meters);
                for (const [id, supplied] of Object.entries(result.usage)) usage[id] = combineUsage(usage[id] ?? emptyUsage(), supplied);
            }
            return { feasible: true, version: context.version, meters, inventory, usage };
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            return failure(context, error.message);
        }
    };

    return {
        assess(context: SiteEnergyProjectionContext, plan: readonly SiteEnergyLoad[]): SiteEnergyAssessment {
            return structuredClone(evaluate(context, [...context.reservations, ...structuredClone(plan)]));
        },
        invalidateQuotes: (): void => quotes.clear(),
        slots(context: SiteEnergyProjectionContext, request: SiteEnergyPublicationRequest): SlotSnapshot[] {
            const [from, to] = windowBounds(request.window);
            if (request.locationId !== config.locationId) return [];
            const hypothetical = [...context.reservations];
            return context.readings.slice(context.cursor).flatMap((input, offset) => {
                const [start, end] = windowBounds(input.window);
                const base: SlotSnapshot = {
                    status: "unavailable", source: input.evidence.source, observedAt: input.evidence.observedAt,
                    version: context.version, projected: offset > 0 || input.evidence.projected, simulated: true,
                };
                if (start >= to) return [];
                const until = context.cursor + offset + 1;
                const baseline = evaluate(context, hypothetical, until);
                if (!baseline.feasible || !input.supply || input.evidence.status !== "current") return end > from ? [base] : [];
                const priorStored = offset === 0 ? context.inventory.storedKWh : baseline.meters[offset - 1].endingStoredKWh;
                const committed = hypothetical.filter(load => containsWindow(input.window, load.window));
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
                    if (evaluate(context, [...hypothetical, candidate(middle)], until).feasible) duration = middle;
                    else upper = middle - 1;
                }
                const proposed = duration > 0 && gpus > 0 ? candidate(duration) : undefined;
                const assessed = proposed ? evaluate(context, [...hypothetical, proposed], until) : baseline;
                const offer: SiteEnergyOffer = {
                    version: context.version, window: { ...input.window }, capGpus: gpus + usedGpus, usedGpus,
                    availablePowerKW: duration > 0 ? gpus * config.compute.kWPerGpu : 0,
                    availableEnergyKWh: gpus * config.compute.kWPerGpu * duration / 3_600_000,
                    supply: proposed ? assessed.usage[id] ?? emptyUsage() : emptyUsage(),
                };
                if (proposed) hypothetical.push(proposed);
                if (end <= from) return [];
                const quoteKey = windowKey(input.window);
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

function failure(context: SiteEnergyProjectionContext, reason: string): SiteEnergyAssessment {
    return { feasible: false, version: context.version, meters: [], inventory: structuredClone(context.inventory), usage: {}, reason };
}

function peakGpus(loads: readonly SiteEnergyLoad[]): number {
    return Math.max(0, ...loads.map(load => {
        const at = Date.parse(load.window.startAt);
        return loads.filter(other => Date.parse(other.window.startAt) <= at && at < Date.parse(other.window.endAt)).reduce((total, other) => total + other.gpus, 0);
    }));
}
