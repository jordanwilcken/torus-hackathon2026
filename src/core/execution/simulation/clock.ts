import type { EnergyMap } from "../../energy/EnergyMap.interface.js";
import type { Job } from "../../jobs/Job.type.js";
import type { JobState } from "../../jobs/JobState.type.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { TickObservation } from "../TickObservation.type.js";
import { fenceEnergyMap } from "./energyFence.js";
import { assertHourAligned, generateWorkload, hourStart, type WorkloadSettings } from "./workload.js";

export type InputEvent = { atHour: number; kind: string; payload?: unknown };
export type WorkloadSpec = { kind: "fixture"; jobs: Array<Job> } | { kind: "generated"; settings: WorkloadSettings };
export type SimulationConfig = {
    seed: number; snapshotId: string; startAt: string; hours: number; syntheticForecast: boolean;
    workload: WorkloadSpec; events?: Array<InputEvent>;
};
export type SimulationInputs = Readonly<SimulationConfig & { jobs: ReadonlyArray<Job>; events: ReadonlyArray<InputEvent>; horizon: TimeWindow }>;
export type PhaseContext = {
    hour: number; tick: TimeWindow; asOf: string; jobs: Array<Job>; arrivals: Array<Job>;
    events: Array<InputEvent>; energy: EnergyMap; syntheticForecast: boolean;
};
export type ScoreContext = PhaseContext & {
    observation?: TickObservation | undefined;
    changes: Array<Extract<SimulationLogEntry, { type: "state" }>>;
};
type Phase<C> = (context: C) => void | Promise<void>;
export type SimulationPhases = {
    observe?: Phase<PhaseContext>; plan?: Phase<PhaseContext>; postPrices?: Phase<PhaseContext>; shop?: Phase<PhaseContext>;
    execute?: (context: PhaseContext) => TickObservation | undefined | Promise<TickObservation | undefined>;
    score?: Phase<ScoreContext>;
};
export type SimulationLogEntry =
    | { hour: number; type: "arrival"; jobId: string }
    | { hour: number; type: "input"; event: InputEvent }
    | { hour: number; type: "state"; jobId: string; state: JobState; by: "executor" | "deadline" };
export type StepResult = { done: false; hour: number; tick: TimeWindow } | { done: true; hour: number };
export type Simulation = {
    readonly hour: number;
    step(): Promise<StepResult>;
    reset(): void;
    schedule(event: InputEvent): void;
    jobs(): Array<Job>;
    /** Replay preserves these inputs, including scheduled events, but cannot guarantee deterministic external callbacks. */
    inputs(): SimulationInputs;
    log(): Array<SimulationLogEntry>;
};
export type SimulationComponents = { energy: EnergyMap; createPhases: (inputs: SimulationInputs) => SimulationPhases };

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value !== null && typeof value === "object" && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value)) deepFreeze(child, seen);
        Object.freeze(value);
    }
    return value;
}

// Inputs are deep-frozen and shared by both arms, so events must be plain JSON-like data: a Map, Date or class
// instance would stay mutable behind the freeze. Each own enumerable value, getters included, is read exactly
// once into a fresh copy, and its prototype is checked before anything could normalize it away.
function capturePlain(value: unknown, path: string, ancestors: Set<object>, captured: WeakMap<object, unknown>): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const fail = () => { throw new RangeError(`Event ${path} must be plain JSON-like data.`); };
    if (typeof value !== "object" || ancestors.has(value)) return fail();
    // A sub-object used twice is captured once, so its getters still run exactly once.
    if (captured.has(value)) return captured.get(value);
    const prototype = Object.getPrototypeOf(value);
    const isArray = Array.isArray(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail();
    if (Object.getOwnPropertySymbols(value).some(key => Object.prototype.propertyIsEnumerable.call(value, key))) return fail();
    ancestors.add(value);
    const copy = (isArray ? new Array((value as Array<unknown>).length) : {}) as Record<string, unknown>;
    // defineProperty, not assignment: a JSON "__proto__" key must stay an own field rather than set the prototype.
    for (const key of Object.keys(value)) Object.defineProperty(copy, key, {
        value: capturePlain((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors, captured),
        enumerable: true, writable: true, configurable: true,
    });
    ancestors.delete(value);
    captured.set(value, copy);
    return copy;
}

/** Copy the caller's event exactly once, so getters or later mutation cannot make two arms disagree. */
function prepareEvent(event: InputEvent): InputEvent {
    const copy = capturePlain(event, "event", new Set(), new WeakMap()) as InputEvent;
    if (typeof copy.kind !== "string") throw new RangeError("Event kind must be a string.");
    return copy;
}

function validateEventHour(event: InputEvent, earliest: number, hours: number): void {
    if (!Number.isInteger(event.atHour) || event.atHour < earliest || event.atHour >= hours)
        throw new RangeError(`Event hour must be an integer in [${earliest}, ${hours}): ${event.atHour}`);
}

function prepareInputs(config: SimulationConfig): SimulationInputs {
    assertHourAligned(config.startAt, config.hours);
    const events = (config.events ?? []).map(prepareEvent);
    for (const event of events) validateEventHour(event, 0, config.hours);
    const { seed, snapshotId, startAt, hours, syntheticForecast, workload } = structuredClone({ ...config, events: undefined });
    const jobs = workload.kind === "fixture" ? workload.jobs : generateWorkload(seed, startAt, hours, workload.settings);
    const ids = new Set<string>();
    for (const job of jobs) {
        if (ids.has(job.id)) throw new RangeError(`Duplicate job id: ${job.id}`);
        ids.add(job.id);
    }
    return deepFreeze({
        seed, snapshotId, startAt, hours, syntheticForecast, workload, jobs, events,
        horizon: { startAt, endAt: hourStart(startAt, hours) },
    });
}

const terminal = (job: Job): boolean => job.state === "done" || job.state === "missed";
const compareIds = (a: Job, b: Job): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

type ArmHandle = { simulation: Simulation; check(event: InputEvent): void; append(event: InputEvent): void };

function createPreparedSimulation(initial: SimulationInputs, { energy, createPhases }: SimulationComponents,
    pairSchedule?: (event: InputEvent) => void): ArmHandle {
    let hour = 0;
    let running = false;
    let broken = false;
    let inputs = initial;
    let jobs = structuredClone([...initial.jobs]);
    let registry = new Map(jobs.map(job => [job.id, job]));
    const arrived = new Set<string>();
    const log: Array<SimulationLogEntry> = [];
    let phases = createPhases(inputs);
    const check = (event: InputEvent) => validateEventHour(event, hour + (running ? 1 : 0), initial.hours);
    const append = (event: InputEvent) => { inputs = deepFreeze({ ...inputs, events: [...inputs.events, event] }); };

    const simulation: Simulation = {
        get hour() { return hour; },
        async step() {
            if (running) throw new Error("Simulation step is already running.");
            if (broken) throw new Error("Simulation step failed; reset before stepping again.");
            if (hour >= initial.hours) return { done: true, hour };
            running = true;
            try {
                const tick = { startAt: hourStart(initial.startAt, hour), endAt: hourStart(initial.startAt, hour + 1) };
                const end = Date.parse(tick.endAt);
                const arrivals = jobs.filter(job => !arrived.has(job.id) && Date.parse(job.readyAt) < end)
                    .sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt) || compareIds(a, b));
                for (const job of arrivals) {
                    arrived.add(job.id);
                    log.push({ hour, type: "arrival", jobId: job.id });
                }
                const events = inputs.events.filter(event => event.atHour === hour);
                for (const event of events) log.push({ hour, type: "input", event });
                const changes: ScoreContext["changes"] = [];
                const changeState = (job: Job, state: JobState, by: "executor" | "deadline") => {
                    if (job.state === state) return;
                    job.state = state;
                    const entry = { hour, type: "state", jobId: job.id, state, by } as const;
                    changes.push(entry);
                    log.push(entry);
                };
                const sweep = (deadline: number) => {
                    for (const job of jobs) {
                        if (arrived.has(job.id) && !terminal(job) && Date.parse(job.window.endAt) <= deadline)
                            changeState(job, "missed", "deadline");
                    }
                };
                // A job that expired before this tick (e.g. a fixture older than the start) can no longer finish on time.
                sweep(Date.parse(tick.startAt));
                const context = (view: EnergyMap): PhaseContext => ({
                    hour, tick: { ...tick }, asOf: tick.startAt,
                    jobs: structuredClone(jobs.filter(job => arrived.has(job.id) && !terminal(job))
                        .sort((a, b) => Date.parse(a.window.endAt) - Date.parse(b.window.endAt) || compareIds(a, b))),
                    arrivals: structuredClone(arrivals), events: structuredClone(events),
                    energy: view, syntheticForecast: initial.syntheticForecast,
                });
                for (const phase of ["observe", "plan", "postPrices", "shop"] as const)
                    await phases[phase]?.(context(fenceEnergyMap(energy, tick.startAt)));
                const observation = structuredClone(await phases.execute?.(context(energy)));
                // Validate the whole batch before applying any report so an invalid id cannot partially finish jobs.
                const reports = (observation?.executions ?? []).map(report => {
                    const job = registry.get(report.jobId);
                    if (!job || !arrived.has(report.jobId))
                        throw new Error(`Executor reported unknown or not-yet-arrived job: ${report.jobId}`);
                    return { job, report };
                });
                for (const { job, report } of reports) {
                    if (terminal(job)) continue;
                    job.remainingGpuH = report.remainingGpuH;
                    changeState(job, report.state, "executor");
                }
                sweep(end);
                await phases.score?.({ ...context(energy), observation, changes: structuredClone(changes) });
                const result: StepResult = { done: false, hour, tick };
                hour += 1;
                return result;
            } catch (error) {
                broken = true;
                throw error;
            } finally {
                running = false;
            }
        },
        reset() {
            if (running) throw new Error("Simulation step is already running.");
            broken = true;
            hour = 0;
            inputs = initial;
            jobs = structuredClone([...initial.jobs]);
            registry = new Map(jobs.map(job => [job.id, job]));
            arrived.clear();
            log.length = 0;
            phases = createPhases(inputs);
            broken = false;
        },
        schedule(event) {
            if (pairSchedule) return pairSchedule(event);
            const prepared = prepareEvent(event);
            check(prepared);
            append(prepared);
        },
        jobs: () => structuredClone(jobs),
        inputs: () => inputs,
        log: () => structuredClone(log),
    };
    return { simulation, check, append };
}

export function createSimulation(config: SimulationConfig, components: SimulationComponents): Simulation {
    return createPreparedSimulation(prepareInputs(config), components).simulation;
}

export function createPolicyArms(config: SimulationConfig, energy: EnergyMap,
    factories: { baseline: SimulationComponents["createPhases"]; selected: SimulationComponents["createPhases"] }) {
    const inputs = prepareInputs(config);
    /** Chaos input for both arms, from either arm or the pair: checked against both first, so it lands in both or neither. */
    const schedule = (event: InputEvent) => {
        const prepared = prepareEvent(event);
        baseline.check(prepared);
        selected.check(prepared);
        baseline.append(prepared);
        selected.append(prepared);
    };
    const baseline = createPreparedSimulation(inputs, { energy, createPhases: factories.baseline }, schedule);
    const selected = createPreparedSimulation(inputs, { energy, createPhases: factories.selected }, schedule);
    return { baseline: baseline.simulation, selected: selected.simulation, schedule };
}
