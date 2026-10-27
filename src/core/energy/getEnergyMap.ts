import type { EnergyMap } from "./EnergyMap.interface.js";
import type { SlotQuery } from "./SlotQuery.interface.js";

/** UI projection of the active map. The caller supplies the requested time. */
export function getEnergyMap(query: SlotQuery, energyMap: EnergyMap, maximumAgeMinutes = 5) {
    const readings = energyMap.findSlots(query).map(reference => ({
        reference,
        snapshot: energyMap.readSlot(reference, query.asOf, maximumAgeMinutes),
        forecast: energyMap.readForecast(reference, query.asOf),
    }));
    const sites = new Map(readings.map(({ reference, snapshot }) => [
        reference.locationId,
        { id: reference.locationId, ...snapshot.location, slots: [] as typeof readings },
    ]));
    for (const reading of readings) sites.get(reading.reference.locationId)!.slots.push(reading);
    return {
        asOf: query.asOf,
        window: { ...query.window },
        label: [...new Set(readings.map(reading => reading.snapshot.source))].join(", ") || "No matching readings",
        sites,
    };
}
