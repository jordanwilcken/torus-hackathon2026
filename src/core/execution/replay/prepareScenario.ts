import { assertHourAligned, hourStart } from "../simulation/workload.js";
import type { ReplayScenario } from "./Replay.types.js";
import { validateReplayEvent } from "./replayEvents.js";

/** Capture the input once before either arm starts. Component constructors validate their own inputs. */
export function prepareScenario(supplied: ReplayScenario): ReplayScenario {
    const scenario = structuredClone(supplied);
    const fail = (reason: string): never => { throw new RangeError(reason); };
    if (scenario.schemaVersion !== 1 || !scenario.id?.trim() || !scenario.inputRevision?.trim() || !scenario.label?.trim())
        fail("Replay requires schemaVersion 1 and declared scenario identity, revision and model label.");
    assertHourAligned(scenario.startAt, scenario.hours);
    if (!Number.isSafeInteger(scenario.seed) || [scenario.maximumAgeMinutes, scenario.storageToleranceKWh,
        scenario.carbonPriceUsdPerTonne].some(value => !Number.isFinite(value) || value < 0))
        fail("Replay needs a safe integer seed and finite nonnegative freshness, storage tolerance and carbon price.");
    if (!scenario.jobs.length || !scenario.sites.length) fail("Replay requires at least one job and one site.");
    if (new Set(scenario.sites.map(site => site.configuration.locationId)).size !== scenario.sites.length)
        fail("Replay site identities must be unique.");
    const start = Date.parse(scenario.startAt);
    const end = Date.parse(hourStart(scenario.startAt, scenario.hours));
    const basis = scenario.sites[0].configuration.accountingBasis;
    if (scenario.routing) {
        const terms = scenario.routing.transfer;
        if (scenario.routing.policy !== "fleet" || !terms || terms.accountingBasis !== basis ||
            [terms.bandwidthGBPerHour, terms.kWhPerGB, terms.jobChargeUsdPerGB].some(value => !Number.isFinite(value) || value <= 0) ||
            [terms.carbonGPerKWh, terms.electricityUsdPerMWh].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)))
            fail("Fleet transfer requires compatible, explicit positive bandwidth, energy and job-charge rates; optional accounting rates must be nonnegative.");
        const profiles = new Map<string, number>();
        for (const site of scenario.sites) {
            const prior = profiles.get(site.computeProfile);
            if (prior !== undefined && prior !== site.configuration.compute.kWPerGpu)
                fail("Fleet sites with the same compute profile require the same declared kWh per GPU-hour.");
            profiles.set(site.computeProfile, site.configuration.compute.kWPerGpu);
        }
    }
    for (const site of scenario.sites) {
        if (site.regionId !== undefined && !site.regionId.trim()) fail("Declared site regions must be nonempty.");
        if ([site.name, site.lat, site.lng].some(value => value !== undefined) &&
            (!site.name?.trim() || !Number.isFinite(site.lat) || !Number.isFinite(site.lng) ||
                Math.abs(site.lat!) > 90 || Math.abs(site.lng!) > 180))
            fail("Declared site geography requires a name and valid latitude/longitude pair.");
        if (!site.computeProfile?.trim() || !basis?.trim() || site.configuration.accountingBasis !== basis)
            fail("Every replay site needs a compute profile and the same declared accounting basis.");
        if (site.forecast.length !== scenario.hours || site.observations.length !== scenario.hours)
            fail("Every site needs one forecast and one observation record per canonical hour.");
        for (let hour = 0; hour < scenario.hours; hour++) {
            const forecast = site.forecast[hour], observed = site.observations[hour];
            const from = Date.parse(hourStart(scenario.startAt, hour));
            const to = Date.parse(hourStart(scenario.startAt, hour + 1));
            for (const input of [forecast, observed]) {
                if (Date.parse(input.window.startAt) !== from || Date.parse(input.window.endAt) !== to)
                    fail("Replay inputs must exactly cover the same ordered hourly horizon.");
            }
            if (!forecast.evidence.projected || !Number.isFinite(Date.parse(forecast.evidence.observedAt)) ||
                Date.parse(forecast.evidence.observedAt) > start)
                fail("Initial forecasts must be explicitly projected and issued by the scenario start.");
            if (observed.evidence.projected || observed.evidence.version === forecast.evidence.version ||
                !Number.isFinite(Date.parse(observed.evidence.observedAt)) ||
                Date.parse(observed.evidence.observedAt) < Date.parse(forecast.evidence.observedAt))
                fail("Realized inputs need a distinct observation version and nondecreasing evidence time.");
        }
    }
    for (const job of scenario.jobs) {
        const home = scenario.sites.find(site => site.configuration.locationId === job.homeLocation);
        if (!home || home.computeProfile !== job.computeProfile || !job.allowedLocations.includes(job.homeLocation) ||
            job.currentLocation !== job.homeLocation || job.transferToLocation !== undefined ||
            job.state !== "queued" || job.remainingGpuH !== job.workGpuH || job.workGpuH <= 0)
            fail("This replay supports fresh queued jobs at an allowed home site with a matching compute profile; initial migration is unsupported.");
        if (scenario.routing && (!Number.isFinite(job.dataGB) || job.dataGB <= 0))
            fail("Fleet transfer requires a positive declared job data size.");
        if (!Number.isFinite(Date.parse(job.readyAt)) || Date.parse(job.readyAt) < start || Date.parse(job.readyAt) >= end ||
            !Number.isFinite(Date.parse(job.window.startAt)) || Date.parse(job.window.startAt) < start ||
            !Number.isFinite(Date.parse(job.window.endAt)) || Date.parse(job.window.endAt) > end)
            fail("Jobs must be ready within the declared replay horizon and have windows contained by it.");
        try {
            assertHourAligned(job.readyAt, 1);
            assertHourAligned(job.window.startAt, 1);
        } catch {
            fail("This replay supports hour-aligned admission: readyAt and job window start must be UTC hour boundaries.");
        }
    }
    for (const event of scenario.events ?? []) validateReplayEvent(scenario, event);
    return scenario;
}
