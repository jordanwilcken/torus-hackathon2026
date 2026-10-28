import type { SiteEnergyLoad, SiteEnergyReservation, SiteEnergyReservationRelease, SiteEnergyReservationResult, SiteEnergyReservations } from "./SiteEnergy.types.js";
import { containsWindow, loadIdentity, validateLoad } from "./siteEnergyInputs.js";

/** Reservation identities and accepted order; the coordinator owns revision changes. */
export function createSiteEnergyReservations(): SiteEnergyReservations {
    const active = new Map<string, SiteEnergyReservation>();
    const accepted = new Map<string, { request: SiteEnergyReservation; result: SiteEnergyReservationResult; released: boolean }>();

    return {
        loads: (): SiteEnergyLoad[] => structuredClone([...active.values()].map(request => request.load)),
        retry(request: SiteEnergyReservation, version: string): SiteEnergyReservationResult | undefined {
            const prior = accepted.get(request.load.id);
            if (!prior) return undefined;
            return !prior.released && prior.request.version === request.version && sameLoad(prior.request.load, request.load)
                ? structuredClone(prior.result)
                : { accepted: false, version, reason: "Reservation identity was already used with different or released inputs." };
        },
        accept(request: SiteEnergyReservation, result: SiteEnergyReservationResult): void {
            const captured = structuredClone(request), outcome = structuredClone(result);
            active.set(captured.load.id, captured);
            accepted.set(captured.load.id, { request: captured, result: outcome, released: false });
        },
        release(reservationId: string): SiteEnergyReservationRelease {
            const prior = accepted.get(reservationId);
            if (!prior) return "missing";
            if (prior.released) return "unchanged";
            if (!active.delete(reservationId)) return "missing";
            prior.released = true;
            return "released";
        },
        actual(loads: readonly SiteEnergyLoad[]): SiteEnergyLoad[] | undefined {
            const actual = new Map<string, SiteEnergyLoad>();
            for (const load of loads) {
                validateLoad(load);
                const reservation = active.get(load.id)?.load;
                if (actual.has(load.id) || !reservation || load.gpus > reservation.gpus || !containsWindow(reservation.window, load.window))
                    return undefined;
                actual.set(load.id, structuredClone(load));
            }
            return [...active.values()].flatMap(({ load }) => actual.has(load.id) ? [actual.get(load.id)!] : []);
        },
        clear: (): void => active.clear(),
    };
}

function sameLoad(left: SiteEnergyLoad, right: SiteEnergyLoad): boolean {
    return JSON.stringify(loadIdentity(left)) === JSON.stringify(loadIdentity(right));
}
