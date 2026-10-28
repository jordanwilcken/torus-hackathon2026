import { expect, test } from 'vitest';
import type { EnergyMap } from '../../../../src/core/energy/EnergyMap.interface.js';
import type { SlotSnapshot } from '../../../../src/core/energy/SlotSnapshot.type.js';
import type { Job } from '../../../../src/core/jobs/Job.type.js';
import type { JobExecution } from '../../../../src/core/execution/JobExecution.type.js';
import {
  createPolicyArms, createSimulation, type PhaseContext, type SimulationConfig, type SimulationPhases,
} from '../../../../src/core/execution/simulation/clock.js';
import { DEFAULT_WORKLOAD_SETTINGS } from '../../../../src/core/execution/simulation/workload.js';
import type { InputEvent } from '../../../../src/core/execution/simulation/clock.js';

type InputEventWithExtras = InputEvent & Record<string, unknown>;

const T0 = '2026-10-27T12:00:00Z';
const at = (hour: number) => new Date(Date.parse(T0) + hour * 3_600_000).toISOString().replace('.000Z', 'Z');
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const fixtureJob = (id: string, arrivalHour: number, deadlineHour: number, workGpuH = 1): Job => ({
  id, workloadRef: 'fixture', computeProfile: 'fixture', window: { startAt: at(arrivalHour), endAt: at(deadlineHour) },
  allowedLocations: ['A'], homeLocation: 'A', currentLocation: 'A', readyAt: at(arrivalHour),
  workGpuH, remainingGpuH: workGpuH, maxGpus: 1, dataGB: 0, state: 'queued',
});

const fixtureConfig = (jobs: Array<Job>, hours = 3, extra: Partial<SimulationConfig> = {}): SimulationConfig => ({
  seed: 1, snapshotId: 'fixture-snapshot', startAt: T0, hours, syntheticForecast: false,
  workload: { kind: 'fixture', jobs }, ...extra,
});

const siteSnapshot = (observedAt: string): SlotSnapshot => ({
  status: 'current', source: 'recorded-site', version: 'v1', observedAt, projected: false, simulated: true,
  slot: {
    id: 'site', locationId: 'A', window: { startAt: at(1), endAt: at(2) }, availablePowerKW: 4,
    availableEnergyKWh: 4, capGpus: 4, usedGpus: 0, postedUsdPerGpuHour: 0.04, priceBasis: 'test',
  },
});

/** Unfenced recorded map: the slot for hour 1 was observed at the start of hour 1. */
const recordedEnergy: EnergyMap = {
  findSlots: () => [{ locationId: 'A', slotId: 'site' }],
  readSlot: () => siteSnapshot(at(1)),
  readForecast: () => ({}),
};

const execution = (job: Job, hour: number, remainingGpuH: number, state: Job['state']): JobExecution => ({
  jobId: job.id, locationId: 'A', window: { startAt: at(hour), endAt: at(hour + 1) },
  completedGpuH: job.remainingGpuH - remainingGpuH, remainingGpuH, state, computeKWh: 0, postedChargeUsd: 0,
});

const recorder = (calls: Array<string>, label = '') => (): SimulationPhases => ({
  observe: ctx => { calls.push(`${label}observe@${ctx.hour}`); },
  plan: ctx => { calls.push(`${label}plan@${ctx.hour}`); },
  postPrices: ctx => { calls.push(`${label}postPrices@${ctx.hour}`); },
  shop: ctx => { calls.push(`${label}shop@${ctx.hour}`); },
  execute: ctx => { calls.push(`${label}execute@${ctx.hour}`); return undefined; },
  score: ctx => { calls.push(`${label}score@${ctx.hour}`); },
});

test('one step runs each phase once for one hour, in loop order, however long each phase takes', async () => {
  const calls: Array<string> = [];
  const seen = (name: string, ctx: PhaseContext) => calls.push(`${name}@${ctx.hour} ${ctx.tick.startAt}-${ctx.tick.endAt} asOf ${ctx.asOf}`);
  const sim = createSimulation(fixtureConfig([]), {
    energy: recordedEnergy,
    createPhases: () => ({
      observe: async ctx => { await delay(15); seen('observe', ctx); },
      plan: ctx => { seen('plan', ctx); },
      postPrices: async ctx => { await delay(5); seen('postPrices', ctx); },
      shop: async ctx => { await delay(1); seen('shop', ctx); },
      execute: async ctx => { await delay(10); seen('execute', ctx); return { feasible: true, executions: [], meters: [] }; },
      score: ctx => { seen('score', ctx); },
    }),
  });

  const result = await sim.step();

  const tick = `${T0}-${at(1)} asOf ${T0}`;
  expect(calls).toEqual(['observe', 'plan', 'postPrices', 'shop', 'execute', 'score'].map(name => `${name}@0 ${tick}`));
  expect(result).toEqual({ done: false, hour: 0, tick: { startAt: T0, endAt: at(1) } });
  expect(sim.hour).toBe(1);
});

test('stepping past the last hour calls nothing and changes nothing', async () => {
  const calls: Array<string> = [];
  const sim = createSimulation(fixtureConfig([fixtureJob('late', 1, 5)], 2), { energy: recordedEnergy, createPhases: recorder(calls) });
  await sim.step();
  await sim.step();
  const callsAtEnd = [...calls];
  const jobsAtEnd = sim.jobs();
  const logAtEnd = sim.log();

  expect(await sim.step()).toEqual({ done: true, hour: 2 });
  expect(calls).toEqual(callsAtEnd);
  expect(sim.hour).toBe(2);
  expect(sim.jobs()).toEqual(jobsAtEnd);
  expect(sim.log()).toEqual(logAtEnd);
});

test('phases see a job only from its arrival hour, earliest deadline first with id ties', async () => {
  const seen: Array<string> = [];
  const jobs = [fixtureJob('late', 1, 3), fixtureJob('b', 0, 3), fixtureJob('a', 0, 3), fixtureJob('urgent', 0, 1)];
  const sim = createSimulation(fixtureConfig(jobs), {
    energy: recordedEnergy,
    createPhases: () => ({
      plan: ctx => { seen.push(`${ctx.hour}: ${ctx.jobs.map(job => job.id).join(',')} | arrived ${ctx.arrivals.map(job => job.id).join(',')}`); },
    }),
  });

  await sim.step();
  await sim.step();

  expect(seen).toEqual(['0: urgent,a,b | arrived a,b,urgent', '1: a,b,late | arrived late']);
});

test('unfinished jobs become missed after their deadline hour; done in the deadline hour wins', async () => {
  const neverSelected = fixtureJob('never-selected', 0, 2);
  const finishes = fixtureJob('finishes', 0, 2);
  const stillRunning = fixtureJob('still-running', 0, 2);
  const later = fixtureJob('later', 0, 3);
  const states = (sim: { jobs(): Array<Job> }) => Object.fromEntries(sim.jobs().map(job => [job.id, job.state]));
  const sim = createSimulation(fixtureConfig([neverSelected, finishes, stillRunning, later]), {
    energy: recordedEnergy,
    createPhases: () => ({
      execute: ctx => ctx.hour !== 1 ? undefined : {
        feasible: true, meters: [],
        executions: [execution(finishes, 1, 0, 'done'), execution(stillRunning, 1, 0.5, 'running')],
      },
    }),
  });

  await sim.step();
  expect(states(sim)).toEqual({ 'never-selected': 'queued', finishes: 'queued', 'still-running': 'queued', later: 'queued' });

  await sim.step();
  expect(states(sim)).toEqual({ 'never-selected': 'missed', finishes: 'done', 'still-running': 'missed', later: 'queued' });
  expect(sim.jobs().find(job => job.id === 'finishes')?.remainingGpuH).toBe(0);
  expect(sim.log().filter(entry => entry.type === 'state')).toEqual([
    { hour: 1, type: 'state', jobId: 'finishes', state: 'done', by: 'executor' },
    { hour: 1, type: 'state', jobId: 'still-running', state: 'running', by: 'executor' },
    { hour: 1, type: 'state', jobId: 'never-selected', state: 'missed', by: 'deadline' },
    { hour: 1, type: 'state', jobId: 'still-running', state: 'missed', by: 'deadline' },
  ]);
});

test('an executor report about a job that has not arrived fails the step until reset', async () => {
  const notYet = fixtureJob('not-yet', 2, 3);
  const sim = createSimulation(fixtureConfig([notYet]), {
    energy: recordedEnergy,
    createPhases: () => ({ execute: () => ({ feasible: true, meters: [], executions: [execution(notYet, 0, 0, 'done')] }) }),
  });

  await expect(sim.step()).rejects.toThrow(/not-yet/);
  expect(sim.jobs()[0].state).toBe('queued');
  await expect(sim.step()).rejects.toThrow(/reset/);
});

test('reset restores hour 0, the original jobs and the configured events, with fresh components', async () => {
  const job = fixtureJob('only', 0, 3);
  const configured = [{ atHour: 2, kind: 'heat-wave', payload: { locationId: 'A' } }];
  const instances: Array<Array<string>> = [];
  const sim = createSimulation(fixtureConfig([job], 3, { events: configured }), {
    energy: recordedEnergy,
    createPhases: () => {
      const calls: Array<string> = [];
      instances.push(calls);
      return {
        plan: ctx => { calls.push(`plan@${ctx.hour}`); if (ctx.hour === 0) sim.schedule({ atHour: 1, kind: 'region-outage' }); },
        execute: ctx => ({ feasible: true, meters: [], executions: ctx.jobs.map(active => execution(active, ctx.hour, 0, 'done')) }),
      };
    },
  });
  const initialJobs = sim.jobs();

  await sim.step();
  await sim.step();
  expect(sim.jobs()[0].state).toBe('done');
  sim.reset();

  expect(sim.hour).toBe(0);
  expect(sim.jobs()).toEqual(initialJobs);
  expect(sim.jobs()[0]).toEqual(job);
  expect(sim.log()).toEqual([]);
  expect(sim.inputs().events).toEqual(configured);
  await sim.step();
  expect(instances).toEqual([['plan@0', 'plan@1'], ['plan@0']]);
});

test('an event scheduled during hour 1 for hour 2 takes effect at hour 2, live and on replay', async () => {
  const outage = { atHour: 2, kind: 'region-outage', payload: { locationId: 'A' } };
  const rejected: Array<string> = [];
  const eventsByHour = (calls: Array<string>) => (): SimulationPhases => ({
    observe: ctx => { calls.push(`${ctx.hour}: ${ctx.events.map(event => event.kind).join(',')}`); },
  });
  const liveCalls: Array<string> = [];
  const live = createSimulation(fixtureConfig([], 4), {
    energy: recordedEnergy,
    createPhases: () => ({
      ...eventsByHour(liveCalls)(),
      plan: ctx => {
        if (ctx.hour !== 1) return;
        const payload = { locationId: 'A' };
        live.schedule({ ...outage, payload });
        payload.locationId = 'mutated after scheduling';
        try { live.schedule({ atHour: 1, kind: 'too-late' }); } catch (error) { rejected.push((error as Error).name); }
      },
    }),
  });
  for (let hour = 0; hour < 4; hour += 1) await live.step();

  const replayCalls: Array<string> = [];
  const replay = createSimulation(fixtureConfig([], 4, { events: live.inputs().events }), {
    energy: recordedEnergy, createPhases: eventsByHour(replayCalls),
  });
  for (let hour = 0; hour < 4; hour += 1) await replay.step();

  expect(liveCalls).toEqual(['0: ', '1: ', '2: region-outage', '3: ']);
  expect(rejected).toEqual(['RangeError']);
  expect(live.inputs().events).toEqual([outage]);
  expect(replayCalls).toEqual(liveCalls);
  expect(replay.log()).toEqual(live.log());
  expect(replay.log()).toEqual([{ hour: 2, type: 'input', event: outage }]);
});

test('both arms share the same generated jobs, arrival hours and input events but keep their own outcomes', async () => {
  const config: SimulationConfig = {
    seed: 42, snapshotId: 'pace-2026-10-week', startAt: T0, hours: 72, syntheticForecast: false,
    workload: { kind: 'generated', settings: { ...DEFAULT_WORKLOAD_SETTINGS, jobCount: 12, sizeMaxGpuH: 64 } },
    events: [{ atHour: 5, kind: 'forecast-bust', payload: { regionId: 'PACE', factor: 1.4 } }],
  };
  const runEverything = (): SimulationPhases => ({
    execute: ctx => ({ feasible: true, meters: [], executions: ctx.jobs.map(job => execution(job, ctx.hour, 0, 'done')) }),
  });
  const runNothing = (): SimulationPhases => ({});
  const arms = createPolicyArms(config, recordedEnergy, { baseline: runEverything, selected: runNothing });
  const policyFree = (sim: typeof arms.baseline) => sim.log().filter(entry => entry.type !== 'state');

  for (let hour = 0; hour < 72; hour += 1) { await arms.baseline.step(); await arms.selected.step(); }
  const baselineLog = arms.baseline.log();
  arms.baseline.reset();
  for (let hour = 0; hour < 72; hour += 1) await arms.baseline.step();

  expect(arms.selected.inputs()).toEqual(arms.baseline.inputs());
  expect(arms.baseline.inputs().jobs).toHaveLength(12);
  expect(arms.baseline.inputs().horizon).toEqual({ startAt: T0, endAt: at(72) });
  expect(createPolicyArms(config, recordedEnergy, { baseline: runNothing, selected: runNothing }).baseline.inputs())
    .toEqual(arms.baseline.inputs());
  expect(policyFree(arms.selected)).toEqual(policyFree(arms.baseline));
  expect(policyFree(arms.baseline).filter(entry => entry.type === 'arrival')).toHaveLength(12);
  expect(new Set(arms.baseline.jobs().map(job => job.state))).toEqual(new Set(['done']));
  expect(new Set(arms.selected.jobs().map(job => job.state))).toEqual(new Set(['missed']));
  expect(arms.baseline.log()).toEqual(baselineLog);
  expect(Object.isFrozen(arms.baseline.inputs().jobs[0].window)).toBe(true);
});

test('planning phases read the map as of tick start; execute and score read realized evidence', async () => {
  const seen: Array<string> = [];
  const read = (name: string) => (ctx: PhaseContext) => {
    seen.push(`${name}@${ctx.hour}:${ctx.energy.readSlot({ locationId: 'A', slotId: 'site' }, ctx.asOf, 120).status}`);
  };
  const sim = createSimulation(fixtureConfig([], 2), {
    energy: recordedEnergy,
    createPhases: () => ({
      observe: read('observe'), plan: read('plan'), postPrices: read('postPrices'), shop: read('shop'),
      execute: ctx => { read('execute')(ctx); return undefined; }, score: read('score'),
    }),
  });

  await sim.step();
  await sim.step();

  expect(seen).toEqual([
    'observe@0:unavailable', 'plan@0:unavailable', 'postPrices@0:unavailable', 'shop@0:unavailable',
    'execute@0:current', 'score@0:current',
    'observe@1:current', 'plan@1:current', 'postPrices@1:current', 'shop@1:current', 'execute@1:current', 'score@1:current',
  ]);
});

test('the synthetic forecast experiment is labeled in the run inputs and every phase', async () => {
  const flags: Array<boolean> = [];
  const sim = createSimulation(fixtureConfig([], 1, { syntheticForecast: true }), {
    energy: recordedEnergy, createPhases: () => ({ plan: ctx => { flags.push(ctx.syntheticForecast); } }),
  });

  await sim.step();

  expect(sim.inputs().syntheticForecast).toBe(true);
  expect(flags).toEqual([true]);
});

test('a second step cannot start while one is still running, and fixture ids must be unique', async () => {
  const sim = createSimulation(fixtureConfig([]), {
    energy: recordedEnergy, createPhases: () => ({ observe: () => delay(10) }),
  });

  const first = sim.step();
  await expect(sim.step()).rejects.toThrow(/already running/);
  await first;
  expect(sim.hour).toBe(1);
  expect(() => createSimulation(fixtureConfig([fixtureJob('twin', 0, 1), fixtureJob('twin', 0, 2)]), {
    energy: recordedEnergy, createPhases: () => ({}),
  })).toThrow(RangeError);
});

test('score receives the observation and executor then deadline changes for this hour only', async () => {
  const job = fixtureJob('partial', 0, 1);
  const observation = { feasible: true, meters: [], executions: [execution(job, 0, 0.5, 'running')] };
  const scores: Array<unknown> = [];
  const sim = createSimulation(fixtureConfig([job], 2), {
    energy: recordedEnergy,
    createPhases: () => ({
      execute: ctx => ctx.hour === 0 ? observation : undefined,
      score: ctx => {
        scores.push(structuredClone({
          observation: ctx.observation, changes: ctx.changes, jobs: ctx.jobs,
        }));
        if (ctx.observation) ctx.observation.executions[0].remainingGpuH = 999;
      },
    }),
  });

  await sim.step();
  await sim.step();

  expect(scores).toEqual([
    { observation: { feasible: true, meters: [], executions: [execution(job, 0, 0.5, 'running')] }, changes: [
      { hour: 0, type: 'state', jobId: 'partial', state: 'running', by: 'executor' },
      { hour: 0, type: 'state', jobId: 'partial', state: 'missed', by: 'deadline' },
    ], jobs: [] },
    { observation: undefined, changes: [], jobs: [] },
  ]);
  expect(observation.executions[0].remainingGpuH).toBe(0.5);
  expect(sim.jobs()).toEqual([{ ...job, remainingGpuH: 0.5, state: 'missed' }]);
});

test.each(['unknown', 'future'])('validates the whole execution batch before applying any result: %s job', async invalidId => {
  const valid = fixtureJob('valid', 0, 1);
  const future = fixtureJob('future', 1, 2);
  const invalid = invalidId === 'future' ? future : fixtureJob('unknown', 0, 1);
  const sim = createSimulation(fixtureConfig([valid, future]), {
    energy: recordedEnergy,
    createPhases: () => ({ execute: () => ({
      feasible: true, meters: [], executions: [execution(valid, 0, 0, 'done'), execution(invalid, 0, 0, 'done')],
    }) }),
  });

  await expect(sim.step()).rejects.toThrow(invalidId);
  expect(sim.jobs()).toEqual([valid, future]);
  expect(sim.log().filter(entry => entry.type === 'state')).toEqual([]);
  expect(sim.hour).toBe(0);
});

test('caller and phase mutations cannot change registry, later contexts, inputs or log', async () => {
  const job = fixtureJob('original', 0, 2);
  const event = { atHour: 0, kind: 'heat-wave', payload: { factor: 1.4 } };
  const config = fixtureConfig([job], 2, { events: [event] });
  const original = structuredClone(job);
  const seen: Array<unknown> = [];
  const sim = createSimulation(config, {
    energy: recordedEnergy,
    createPhases: () => ({
      observe: ctx => {
        ctx.jobs[0].window.endAt = at(0);
        ctx.jobs[0].allowedLocations.push('B');
        ctx.arrivals[0].state = 'done';
        ctx.events[0].kind = 'mutated';
        (ctx.events[0].payload as { factor: number }).factor = 99;
        ctx.tick.endAt = at(99);
      },
      plan: ctx => { seen.push(structuredClone({ jobs: ctx.jobs, arrivals: ctx.arrivals, events: ctx.events, tick: ctx.tick })); },
    }),
  });
  job.id = 'changed by caller';
  event.payload.factor = 999;
  config.hours = 100;
  await sim.step();
  sim.jobs()[0].state = 'done';
  const logCopy = sim.log();
  if (logCopy[1]?.type === 'input') logCopy[1].event.kind = 'changed log';

  expect(seen).toEqual([{ jobs: [original], arrivals: [original],
    events: [{ atHour: 0, kind: 'heat-wave', payload: { factor: 1.4 } }], tick: { startAt: T0, endAt: at(1) } }]);
  expect(sim.jobs()).toEqual([original]);
  expect(sim.inputs().hours).toBe(2);
  expect(sim.log()).toEqual([
    { hour: 0, type: 'arrival', jobId: 'original' },
    { hour: 0, type: 'input', event: { atHour: 0, kind: 'heat-wave', payload: { factor: 1.4 } } },
  ]);
  for (const value of [sim.inputs(), sim.inputs().workload, sim.inputs().jobs, sim.inputs().jobs[0],
    sim.inputs().jobs[0].allowedLocations, sim.inputs().events, sim.inputs().events[0].payload, sim.inputs().horizon]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
});

test('schedule enforces integer hours within the remaining horizon and preserves same-hour order', async () => {
  const sim = createSimulation(fixtureConfig([], 2, { events: [{ atHour: 1, kind: 'configured' }] }), {
    energy: recordedEnergy, createPhases: () => ({}),
  });
  for (const atHour of [-1, 0.5, 2, NaN, Infinity]) {
    expect(() => sim.schedule({ atHour, kind: 'invalid' })).toThrow(RangeError);
  }
  sim.schedule({ atHour: 0, kind: 'now' });
  await sim.step();
  expect(() => sim.schedule({ atHour: 0, kind: 'past' })).toThrow(RangeError);
  sim.schedule({ atHour: 1, kind: 'first' });
  sim.schedule({ atHour: 1, kind: 'second' });
  await sim.step();
  expect(sim.log()).toEqual([
    { hour: 0, type: 'input', event: { atHour: 0, kind: 'now' } },
    { hour: 1, type: 'input', event: { atHour: 1, kind: 'configured' } },
    { hour: 1, type: 'input', event: { atHour: 1, kind: 'first' } },
    { hour: 1, type: 'input', event: { atHour: 1, kind: 'second' } },
  ]);
  expect(() => sim.schedule({ atHour: 2, kind: 'after end' })).toThrow(RangeError);
});

test('terminal jobs cannot be overwritten by later executor reports', async () => {
  const done = { ...fixtureJob('done', 0, 1), state: 'done' as const, remainingGpuH: 0 };
  const missed = { ...fixtureJob('missed', 0, 1), state: 'missed' as const };
  const sim = createSimulation(fixtureConfig([done, missed], 1), {
    energy: recordedEnergy,
    createPhases: () => ({ execute: () => ({ feasible: true, meters: [], executions: [
      execution(done, 0, 1, 'running'), execution(missed, 0, 0, 'done'),
    ] }) }),
  });
  await sim.step();
  expect(sim.jobs()).toEqual([done, missed]);
  expect(sim.log()).toEqual([
    { hour: 0, type: 'arrival', jobId: 'done' }, { hour: 0, type: 'arrival', jobId: 'missed' },
  ]);
});

test.each(['observe', 'plan', 'postPrices', 'shop', 'execute', 'score'] as const)('%s failure blocks stepping until fresh components are created by reset', async phase => {
  let instances = 0;
  const sim = createSimulation(fixtureConfig([], 1), {
    energy: recordedEnergy,
    createPhases: () => {
      instances += 1;
      return instances === 1 ? { [phase]: async () => { throw new Error('phase failed'); } } : {};
    },
  });
  await expect(sim.step()).rejects.toThrow('phase failed');
  await expect(sim.step()).rejects.toThrow(/reset/);
  expect(sim.hour).toBe(0);
  sim.reset();
  expect(await sim.step()).toEqual({ done: false, hour: 0, tick: { startAt: T0, endAt: at(1) } });
  expect(instances).toBe(2);
});

test('policy arms share frozen generated inputs and replay retains generated jobs and runtime events', async () => {
  const config: SimulationConfig = {
    ...fixtureConfig([], 72), workload: { kind: 'generated', settings: { ...DEFAULT_WORKLOAD_SETTINGS, jobCount: 4 } },
    events: [{ atHour: 0, kind: 'configured' }],
  };
  const arms = createPolicyArms(config, recordedEnergy, { baseline: () => ({}), selected: () => ({}) });
  expect(arms.baseline.inputs().jobs).toBe(arms.selected.inputs().jobs);
  expect(arms.baseline.inputs().events).toBe(arms.selected.inputs().events);
  expect(arms.baseline.inputs().jobs).toHaveLength(4);
  arms.selected.schedule({ atHour: 1, kind: 'runtime' });
  expect(arms.baseline.inputs().events).toEqual([{ atHour: 0, kind: 'configured' }, { atHour: 1, kind: 'runtime' }]);
  const replay = createSimulation({ ...config, events: arms.selected.inputs().events }, {
    energy: recordedEnergy, createPhases: () => ({}),
  });
  expect(replay.inputs()).toEqual(arms.selected.inputs());
  for (let hour = 0; hour < 72; hour += 1) { await arms.selected.step(); await replay.step(); }
  expect(replay.log()).toEqual(arms.selected.log());
});

test('arrivals use ready time strictly before tick end, ordered by ready time then id', async () => {
  const middle = { ...fixtureJob('middle', 0, 3), readyAt: '2026-10-27T12:30:00Z' };
  const first = fixtureJob('first', 0, 3);
  const boundary = fixtureJob('boundary', 1, 3);
  const sim = createSimulation(fixtureConfig([boundary, middle, first], 2), {
    energy: recordedEnergy, createPhases: () => ({}),
  });
  await sim.step();
  await sim.step();
  expect(sim.log()).toEqual([
    { hour: 0, type: 'arrival', jobId: 'first' }, { hour: 0, type: 'arrival', jobId: 'middle' },
    { hour: 1, type: 'arrival', jobId: 'boundary' },
  ]);
});

test.each([
  { startAt: '2026-10-27T12:01:00Z' }, { startAt: 'invalid' }, { hours: 0 }, { hours: 1.5 },
  { events: [{ atHour: -1, kind: 'invalid' }] }, { events: [{ atHour: 3, kind: 'invalid' }] },
])('invalid simulation bounds or configured event hours fail at creation: %j', extra => {
  expect(() => createSimulation(fixtureConfig([], 3, extra), {
    energy: recordedEnergy, createPhases: () => ({}),
  })).toThrow(RangeError);
});

test('scheduling through the arm pair reaches both arms, or neither when one arm is already past that hour', async () => {
  const arms = createPolicyArms(fixtureConfig([], 3), recordedEnergy, { baseline: () => ({}), selected: () => ({}) });

  arms.schedule({ atHour: 1, kind: 'region-outage', payload: { locationId: 'A' } });
  await arms.selected.step();
  await arms.selected.step();
  expect(() => arms.schedule({ atHour: 1, kind: 'too-late-for-selected' })).toThrow(RangeError);
  await arms.baseline.step();
  await arms.baseline.step();

  const outage = { atHour: 1, kind: 'region-outage', payload: { locationId: 'A' } };
  expect(arms.baseline.inputs().events).toEqual([outage]);
  expect(arms.selected.inputs().events).toEqual([outage]);
  expect(arms.baseline.log()).toEqual([{ hour: 1, type: 'input', event: outage }]);
  expect(arms.selected.log()).toEqual(arms.baseline.log());
});

test.each([
  ['a Map', new Map([['factor', 1]])], ['a Date', new Date(0)], ['a function', () => 1], ['NaN', Number.NaN],
])('event payloads must be plain JSON-like data so frozen inputs stay immutable: %s', (_label, payload) => {
  expect(() => createSimulation(fixtureConfig([], 2, { events: [{ atHour: 0, kind: 'bad', payload }] }), {
    energy: recordedEnergy, createPhases: () => ({}),
  })).toThrow(RangeError);
  const sim = createSimulation(fixtureConfig([], 2), { energy: recordedEnergy, createPhases: () => ({}) });
  expect(() => sim.schedule({ atHour: 1, kind: 'bad', payload })).toThrow(RangeError);
  expect(sim.inputs().events).toEqual([]);
});

test('a job whose deadline passed before the tick starts is missed before any phase sees it', async () => {
  const expired = { ...fixtureJob('expired', 0, 1), readyAt: at(-2), window: { startAt: at(-2), endAt: '2026-10-27T11:30:00Z' } };
  const seen: Array<string> = [];
  const sim = createSimulation(fixtureConfig([expired], 1), {
    energy: recordedEnergy,
    createPhases: () => ({
      plan: ctx => { seen.push(ctx.jobs.map(job => job.id).join(',')); },
      execute: () => ({ feasible: true, meters: [], executions: [execution(expired, 0, 0, 'done')] }),
    }),
  });

  await sim.step();

  expect(seen).toEqual(['']);
  expect(sim.jobs()[0].state).toBe('missed');
  expect(sim.log()).toEqual([
    { hour: 0, type: 'arrival', jobId: 'expired' },
    { hour: 0, type: 'state', jobId: 'expired', state: 'missed', by: 'deadline' },
  ]);
});

test('generated jobs arrive in the log at the hour their readyAt names', async () => {
  const sim = createSimulation({
    ...fixtureConfig([], 72), workload: { kind: 'generated', settings: { ...DEFAULT_WORKLOAD_SETTINGS, jobCount: 6, sizeMaxGpuH: 64 } },
  }, { energy: recordedEnergy, createPhases: () => ({}) });
  for (let hour = 0; hour < 72; hour += 1) await sim.step();

  const expected = sim.inputs().jobs.map(job => ({ hour: (Date.parse(job.readyAt) - Date.parse(T0)) / 3_600_000, jobId: job.id }));
  const logged = sim.log().filter(entry => entry.type === 'arrival').map(entry => ({ hour: entry.hour, jobId: entry.jobId }));
  expect(expected.every(arrival => Number.isInteger(arrival.hour) && arrival.hour > 0)).toBe(true);
  expect(logged).toEqual(expected);
});

test('scheduling on either arm of a pair reaches both, and internal checks are not exposed', () => {
  const arms = createPolicyArms(fixtureConfig([], 3), recordedEnergy, { baseline: () => ({}), selected: () => ({}) });

  arms.baseline.schedule({ atHour: 2, kind: 'heat-wave' });

  expect(arms.selected.inputs().events).toEqual([{ atHour: 2, kind: 'heat-wave' }]);
  expect(arms.baseline.inputs().events).toEqual([{ atHour: 2, kind: 'heat-wave' }]);
  expect('checkSchedule' in arms.baseline).toBe(false);
  expect('checkSchedule' in createSimulation(fixtureConfig([]), { energy: recordedEnergy, createPhases: () => ({}) })).toBe(false);
});

test('an event is read once, so getters cannot give the two arms different events', () => {
  const arms = createPolicyArms(fixtureConfig([], 3), recordedEnergy, { baseline: () => ({}), selected: () => ({}) });
  let reads = 0;
  const event = { atHour: 1, get kind() { reads += 1; return `heat-wave-${reads}`; }, payload: { factor: 1 } };

  arms.schedule(event);

  expect(arms.baseline.inputs().events).toEqual([{ atHour: 1, kind: 'heat-wave-1', payload: { factor: 1 } }]);
  expect(arms.selected.inputs().events).toEqual(arms.baseline.inputs().events);
});

test('array payloads with extra non-index properties are validated too', () => {
  const payload = Object.assign([1, 2], { metadata: new Map([['factor', 1]]) });

  expect(() => createSimulation(fixtureConfig([], 2, { events: [{ atHour: 0, kind: 'bad', payload }] }), {
    energy: recordedEnergy, createPhases: () => ({}),
  })).toThrow(RangeError);
  const sim = createSimulation(fixtureConfig([], 2), { energy: recordedEnergy, createPhases: () => ({}) });
  expect(() => sim.schedule({ atHour: 1, kind: 'bad', payload })).toThrow(RangeError);
});

test('extra event fields are validated like the payload and cannot share mutable state between arms', () => {
  const metadata = new Map([['factor', 1]]);
  const event = { atHour: 1, kind: 'heat-wave', metadata } as InputEventWithExtras;

  expect(() => createSimulation(fixtureConfig([], 2, { events: [event] }), {
    energy: recordedEnergy, createPhases: () => ({}),
  })).toThrow(RangeError);
  const arms = createPolicyArms(fixtureConfig([], 2), recordedEnergy, { baseline: () => ({}), selected: () => ({}) });
  expect(() => arms.schedule(event)).toThrow(RangeError);
  expect(arms.baseline.inputs().events).toEqual([]);
  expect(arms.selected.inputs().events).toEqual([]);
});

class Factor { constructor(readonly value: number) {} }
class Hours extends Array<number> {}

test.each([
  ['a class instance payload', { atHour: 1, kind: 'bad', payload: new Factor(1) }],
  ['a nested class instance', { atHour: 1, kind: 'bad', payload: { factor: new Factor(1) } }],
  ['an Array subclass payload', { atHour: 1, kind: 'bad', payload: Hours.from([1, 2]) }],
  ['a class instance as the event', Object.assign(new Factor(1), { atHour: 1, kind: 'bad' })],
])('events built from class instances are rejected rather than normalized: %s', (_label, event) => {
  const sim = createSimulation(fixtureConfig([], 2), { energy: recordedEnergy, createPhases: () => ({}) });

  expect(() => sim.schedule(event as InputEventWithExtras)).toThrow(RangeError);
  expect(sim.inputs().events).toEqual([]);
});

test('a non-string event kind is rejected', () => {
  const sim = createSimulation(fixtureConfig([], 2), { energy: recordedEnergy, createPhases: () => ({}) });

  expect(() => sim.schedule({ atHour: 1, kind: 7 } as unknown as InputEventWithExtras)).toThrow(RangeError);
});

test.each([
  ['a getter returning a class instance', { atHour: 1, kind: 'bad', get payload() { return new Factor(7); } }],
  ['a nested getter returning a class instance', { atHour: 1, kind: 'bad', metadata: { get nested() { return new Factor(1); } } }],
  ['a nested getter returning an Array subclass', { atHour: 1, kind: 'bad', payload: { get hours() { return Hours.from([1, 2]); } } }],
  ['a symbol-keyed extra field', { atHour: 1, kind: 'bad', [Symbol('extra')]: new Map() }],
])('values behind getters or symbol keys are validated too: %s', (_label, event) => {
  const arms = createPolicyArms(fixtureConfig([], 2), recordedEnergy, { baseline: () => ({}), selected: () => ({}) });

  expect(() => createSimulation(fixtureConfig([], 2, { events: [event as InputEventWithExtras] }), {
    energy: recordedEnergy, createPhases: () => ({}),
  })).toThrow(RangeError);
  expect(() => arms.schedule(event as InputEventWithExtras)).toThrow(RangeError);
  expect(arms.baseline.inputs().events).toEqual([]);
});
