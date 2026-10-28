import type { InputEvent } from "../simulation/clock.js";
import type { SiteEnergyInput } from "../../energy/site/SiteEnergy.types.js";
import type { ReplayScenario } from "./Replay.types.js";

/** One bounded event changes realized solar only; both policies retain the same forecast and event. */
export function validateReplayEvent(scenario: ReplayScenario, event: InputEvent, earliestHour = 0): void {
    const payload = event.payload as { locationId?: unknown } | undefined;
    if (event.kind !== "solar-drop" || !payload || typeof payload.locationId !== "string" ||
        !scenario.sites.some(site => site.configuration.locationId === payload.locationId))
        throw new RangeError("Replay supports a solar-drop event at a declared site.");
    if (!Number.isInteger(event.atHour) || event.atHour < earliestHour || event.atHour >= scenario.hours)
        throw new RangeError("Replay events must target an unsettled hour within the horizon.");
}

export function applyReplayEvents(input: SiteEnergyInput, locationId: string, events: InputEvent[]): SiteEnergyInput {
    const observed = structuredClone(input);
    if (events.some(event => event.kind === "solar-drop" &&
        (event.payload as { locationId: string }).locationId === locationId)) {
        if (observed.supply) observed.supply.solarKW = 0;
        observed.evidence.version += ":solar-drop";
        observed.evidence.source += "; declared solar-drop scenario event";
    }
    return observed;
}
