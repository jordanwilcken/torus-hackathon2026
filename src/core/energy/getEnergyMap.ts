import type { EnergyMap } from "./EnergyMap.interface.js";
import type { SlotQuery } from "./SlotQuery.interface.js";

/** UI projection of the active map. The caller supplies the requested time. */
export function getEnergyMap(query: SlotQuery, energyMap: EnergyMap, maximumAgeMinutes = 5) {
    const readings = energyMap.findSlots(query).map(reference => {
        const snapshot = energyMap.readSlot(reference, query.asOf, maximumAgeMinutes);
        const slot = snapshot.slot;
        const at = Date.parse(query.asOf);
        const availableNow = snapshot.status === 'current' && !snapshot.projected && slot !== undefined &&
            Date.parse(slot.window.startAt) <= at && at < Date.parse(slot.window.endAt) &&
            slot.capGpus > slot.usedGpus && slot.availablePowerKW > 0 && slot.availableEnergyKWh > 0;
        return { reference, snapshot, forecast: energyMap.readForecast(reference, query.asOf), availableNow };
    });
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
