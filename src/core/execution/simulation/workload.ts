import type { Job } from "../../jobs/Job.type.js";
import { createRandom } from "./random.js";

const HOUR_MS = 3_600_000;

/**
 * Design §5 job shape. Job has no urgency field, so urgency is encoded through slack (§3, §9.2):
 * slack = deadline hours − ceil(workGpuH / maxGpus). A job with slack ≤ urgentMaxSlackHours is
 * urgent — the shopping rule's must-run zone — and every other job is flexible.
 */
export type WorkloadSettings = {
    jobCount: number;
    /** Bounded Pareto job size in GPU-hours; a shape near 1 gives the heavy tail. */
    sizeMinGpuH: number;
    sizeMaxGpuH: number;
    sizeParetoShape: number;
    maxGpus: number;
    /** Arrival weight per hour = 1 + amplitude × cos(2π (UTC hour − peak) / 24). */
    arrivalPeakHourUtc: number;
    diurnalAmplitude: number;
    urgentShare: number;
    /** Urgent jobs draw whole-hour slack from 0..urgentMaxSlackHours; flexible jobs from this range. */
    urgentMaxSlackHours: number;
    flexibleSlackHours: { min: number; max: number };
    locations: Array<string>;
    computeProfile: string;
    workloadRef: string;
    dataGB: number;
};

export const DEFAULT_WORKLOAD_SETTINGS: Readonly<WorkloadSettings> = Object.freeze({
    jobCount: 60,
    sizeMinGpuH: 1,
    sizeMaxGpuH: 256,
    sizeParetoShape: 1.1,
    maxGpus: 8,
    arrivalPeakHourUtc: 18,
    diurnalAmplitude: 0.6,
    urgentShare: 0.3,
    urgentMaxSlackHours: 1,
    flexibleSlackHours: Object.freeze({ min: 2, max: 24 }),
    locations: Object.freeze(["A"]) as Array<string>,
    computeProfile: "synthetic-0.85-kWh-per-GPUh",
    workloadRef: "synthetic-batch",
    dataGB: 0,
});

export function runHours(job: Pick<Job, "workGpuH" | "maxGpus">): number {
    return Math.ceil(job.workGpuH / job.maxGpus);
}

/** Slack at arrival, in hours: time to deadline minus whole hours of running at maxGpus. */
export function slackHours(job: Job): number {
    return (Date.parse(job.window.endAt) - Date.parse(job.readyAt)) / HOUR_MS - runHours(job);
}

export function classifyJob(job: Job, settings: Pick<WorkloadSettings, "urgentMaxSlackHours"> = DEFAULT_WORKLOAD_SETTINGS): "urgent" | "flexible" {
    return slackHours(job) <= settings.urgentMaxSlackHours ? "urgent" : "flexible";
}

export function hourStart(startAt: string, hour: number): string {
    return new Date(Date.parse(startAt) + hour * HOUR_MS).toISOString().replace(".000Z", "Z");
}

export function assertHourAligned(startAt: string, hours: number): void {
    const start = Date.parse(startAt);
    if (!Number.isFinite(start) || start % HOUR_MS !== 0) throw new RangeError(`Start must be a UTC hour boundary: ${startAt}`);
    if (!Number.isInteger(hours) || hours <= 0) throw new RangeError("Simulation hours must be a positive integer.");
}

function validate(settings: WorkloadSettings, hours: number): void {
    const { sizeMinGpuH: min, sizeMaxGpuH: max, flexibleSlackHours: flexible } = settings;
    const fail = (message: string) => { throw new RangeError(message); };
    if (!Number.isInteger(settings.jobCount) || settings.jobCount < 0) fail("jobCount must be a nonnegative integer.");
    if (!(min > 0 && max >= min)) fail("Job sizes need 0 < sizeMinGpuH <= sizeMaxGpuH.");
    if (!(settings.sizeParetoShape > 0)) fail("sizeParetoShape must be positive.");
    if (!Number.isInteger(settings.maxGpus) || settings.maxGpus < 1) fail("maxGpus must be a positive integer.");
    if (!(settings.diurnalAmplitude >= 0 && settings.diurnalAmplitude < 1)) fail("diurnalAmplitude must be in [0, 1).");
    if (!(settings.urgentShare >= 0 && settings.urgentShare <= 1)) fail("urgentShare must be in [0, 1].");
    if (!Number.isInteger(settings.urgentMaxSlackHours) || settings.urgentMaxSlackHours < 0) fail("urgentMaxSlackHours must be a nonnegative integer.");
    if (!Number.isInteger(flexible.min) || !Number.isInteger(flexible.max) ||
        flexible.min <= settings.urgentMaxSlackHours || flexible.max < flexible.min)
        fail("Flexible slack must be whole hours above the urgent limit.");
    if (settings.locations.length === 0) fail("At least one location is required.");
    if (runHours({ workGpuH: max, maxGpus: settings.maxGpus }) + flexible.max > hours)
        fail("The largest job plus the largest slack must fit inside the simulation horizon.");
}

/**
 * Deterministic synthetic workload: same seed, window and settings give the same jobs.
 * Every job's deadline fits inside the horizon and leaves nonnegative slack, so a policy that
 * runs it at maxGpus from arrival can finish it; shared-capacity contention is the policy's problem.
 */
export function generateWorkload(seed: number, startAt: string, hours: number, settings: WorkloadSettings): Array<Job> {
    assertHourAligned(startAt, hours);
    validate(settings, hours);
    const random = createRandom(seed);
    const startHourOfDay = new Date(startAt).getUTCHours();
    const weights = Array.from({ length: hours }, (_, hour) =>
        1 + settings.diurnalAmplitude * Math.cos(2 * Math.PI * (startHourOfDay + hour - settings.arrivalPeakHourUtc) / 24));
    const { sizeMinGpuH: low, sizeMaxGpuH: high, sizeParetoShape: shape } = settings;
    const tail = 1 - (low / high) ** shape;

    const drafts = Array.from({ length: settings.jobCount }, (_, draft) => {
        const urgent = random() < settings.urgentShare;
        const size = low / (1 - random() * tail) ** (1 / shape);
        const workGpuH = Math.min(high, Math.max(low, Math.round(size * 100) / 100));
        const slack = urgent
            ? Math.floor(random() * (settings.urgentMaxSlackHours + 1))
            : settings.flexibleSlackHours.min + Math.floor(random() * (settings.flexibleSlackHours.max - settings.flexibleSlackHours.min + 1));
        const duration = runHours({ workGpuH, maxGpus: settings.maxGpus }) + slack;
        // Arrivals are drawn only from hours whose deadline still fits, which thins the diurnal shape near the end.
        const latest = hours - duration;
        let pick = random() * weights.slice(0, latest + 1).reduce((sum, weight) => sum + weight, 0);
        let arrival = 0;
        while (arrival < latest && (pick -= weights[arrival]) >= 0) arrival += 1;
        const home = settings.locations[Math.floor(random() * settings.locations.length)];
        return { draft, arrival, duration, workGpuH, home };
    });

    return drafts
        .sort((a, b) => a.arrival - b.arrival || a.draft - b.draft)
        .map((draft, index): Job => ({
            id: `job-${String(index + 1).padStart(4, "0")}`,
            workloadRef: settings.workloadRef,
            computeProfile: settings.computeProfile,
            window: { startAt: hourStart(startAt, draft.arrival), endAt: hourStart(startAt, draft.arrival + draft.duration) },
            allowedLocations: [...settings.locations],
            homeLocation: draft.home,
            currentLocation: draft.home,
            readyAt: hourStart(startAt, draft.arrival),
            workGpuH: draft.workGpuH,
            remainingGpuH: draft.workGpuH,
            maxGpus: settings.maxGpus,
            dataGB: settings.dataGB,
            state: "queued",
        }));
}
