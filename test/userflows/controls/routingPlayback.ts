import { createSimulation, type InputEvent } from '../../../src/core/execution/simulation/clock';
import { chooseExecutionSlot } from '../../../src/core/scheduling/chooseExecutionSlot';
import { reportableJob, withReporting } from '../../../src/core/reporting/impact/reportableJob';
import type { Job } from '../../../src/core/jobs/Job.type';
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type';
import type { JobObservations } from '../../../src/core/reporting/JobObservations.type';
import type { PlaybackState, ScenarioMenu } from '../../../src/ui/core/controls/PlaybackControls.types';
import { createStreamScenario, scenarioEvents, jobs, routingOptions, startAt, timestamp, totalHours } from './streamScenario';

type Attempt = { asOf: string; outcome: JobOutcome };
export type PlaybackJob = {
  job: Job; phase: 'upcoming' | 'choosing' | 'decided' | 'failed';
  attempts: Attempt[]; observations: JobObservations;
};
type Snapshot = {
  playback: PlaybackState; jobs: PlaybackJob[]; activeId: string;
  viewAt: string; routeAttempt: number;
  scenario: ScenarioMenu;
  events: { input: InputEvent; label: string; state: 'scheduled' | 'applied'; message: string }[];
};

/** Demo composition only: real arrival clock and routing, supplied prices, no executor. */
export function createRoutingPlayback() {
  const supplied = createStreamScenario();
  const listeners = new Set<() => void>();
  let disposed = false;
  let playing = false;
  let failed = false;
  let ticking = false;
  let appliedThisTick: string[] = [];
  let nextHour: ReturnType<typeof setTimeout> | undefined;
  let dwell: { timer: ReturnType<typeof setTimeout>; finish: () => void } | undefined;
  let snapshot: Snapshot = initial();
  let observers = new Map(jobs.map(job => [job.id, reportableJob(job.id)]));

  function initial(speed = 1): Snapshot {
    return {
      playback: { hour: 0, totalHours, currentTime: startAt, mode: 'paused', speed,
        speedOptions: [1, 2, 4], busy: false, allowEventSchedulingWhileBusy: true,
        condition: { kind: 'healthy', message: 'Real clock and chooser; sample hourly prices.' } },
      jobs: jobs.map(job => ({ job, phase: 'upcoming', attempts: [], observations: { jobId: job.id } })),
      activeId: jobs[0].id, viewAt: startAt, routeAttempt: 0,
      scenario: { events: scenarioEvents(0), selectedEventId: 'site-outage' }, events: [],
    };
  }
  function publish(patch: Partial<Snapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  }
  function playback(patch: Partial<PlaybackState>) {
    publish({ playback: { ...snapshot.playback, ...patch } });
  }
  function updateJob(id: string, patch: Partial<PlaybackJob>) {
    publish({ jobs: snapshot.jobs.map(entry => entry.job.id === id ? { ...entry, ...patch } : entry) });
  }
  function wait(milliseconds: number): Promise<void> {
    if (disposed || milliseconds === 0) return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => { dwell = undefined; resolve(); };
      dwell = { timer: setTimeout(finish, milliseconds), finish };
    });
  }
  const simulation = createSimulation({
    seed: 3, snapshotId: 'job-stream-example', startAt, hours: totalHours,
    syntheticForecast: true, workload: { kind: 'fixture', jobs },
  }, { energy: supplied.energy, createPhases: () => ({
    observe(context) {
      for (const input of context.events) {
        const message = supplied.apply(input);
        appliedThisTick.push(message);
        const index = snapshot.events.findIndex(event => event.state === 'scheduled' &&
          event.input.atHour === input.atHour && event.input.kind === input.kind);
        publish({ events: snapshot.events.map((event, i) => i === index ? { ...event, state: 'applied', message } : event) });
      }
      if (appliedThisTick.length) playback({ condition: {
        kind: 'degraded', message: 'Sample scenario changed. The chooser is using the revised supplied inputs.',
      } });
    },
    async shop(context) {
      for (const job of context.jobs) {
        if (disposed) return;
        const entry = snapshot.jobs.find(item => item.job.id === job.id)!;
        // A selected decision is retained for inspection; it is never counted as execution.
        if (entry.attempts.at(-1)?.outcome.selected) continue;
        const observer = observers.get(job.id)!;
        publish({ activeId: job.id, viewAt: context.asOf, routeAttempt: snapshot.routeAttempt + 1 });
        updateJob(job.id, { phase: 'choosing', observations: { jobId: job.id, submittedJob: job } });
        await wait(playing ? 450 / snapshot.playback.speed : 0);
        if (disposed) return;
        const route = withReporting(
          candidate => chooseExecutionSlot(candidate, context.energy, routingOptions(context.asOf)), observer);
        let outcome: JobOutcome;
        try { outcome = await route(job); }
        catch (error) {
          updateJob(job.id, { phase: 'failed', observations: observer.readObservations() });
          throw error;
        }
        updateJob(job.id, { phase: 'decided',
          attempts: [...entry.attempts, { asOf: context.asOf, outcome }], observations: observer.readObservations() });
        // Both modes leave time for this preview's 700ms/speed route reveal before the next job.
        await wait((playing ? 1600 : 900) / snapshot.playback.speed);
      }
    },
  }) });

  function stopTimer() {
    if (nextHour !== undefined) clearTimeout(nextHour);
    nextHour = undefined;
  }
  function refreshEventHour() {
    const hour = simulation.hour + (ticking ? 1 : 0);
    publish({ scenario: { ...snapshot.scenario, events: scenarioEvents(Math.min(hour, totalHours - 1)) } });
    playback({ allowEventSchedulingWhileBusy: hour < totalHours });
  }
  function showFailure(error: unknown) {
    playing = false;
    failed = true;
    stopTimer();
    playback({ mode: 'paused', response: { kind: 'error',
      message: (error instanceof Error ? error.message : String(error)) + ' Reset to retry.' } });
  }
  async function advance() {
    if (disposed || snapshot.playback.busy || simulation.hour >= totalHours) return;
    if (failed) throw new Error('Reset before retrying the failed simulation.');
    ticking = true;
    appliedThisTick = [];
    refreshEventHour();
    playback({ busy: true, response: undefined });
    try {
      await simulation.step();
      if (disposed) return;
      const complete = simulation.hour === totalHours;
      if (complete) playing = false;
      playback({ hour: simulation.hour, currentTime: timestamp(simulation.hour),
        mode: complete ? 'complete' : playing ? 'playing' : 'paused',
        response: { kind: 'info', message: complete ? 'Run complete. Inspect any job or Reset to try another event.'
          : appliedThisTick.length ? 'Applied: ' + appliedThisTick.join(' ')
          : 'Hour reviewed. Waiting jobs will be reconsidered on the next tick.' } });
    } catch (error) {
      showFailure(error);
      throw error;
    } finally {
      ticking = false;
      refreshEventHour();
      playback({ busy: false });
    }
    if (playing && !disposed) nextHour = setTimeout(() => {
      nextHour = undefined;
      void advance().catch(() => { /* advance reports failure through supplied state. */ });
    }, 900 / snapshot.playback.speed);
  }

  return {
    energy: supplied.energy,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    play() {
      if (playing || disposed || snapshot.playback.busy || simulation.hour >= totalHours) return;
      if (failed) throw new Error('Reset before retrying the failed simulation.');
      playing = true;
      playback({ mode: 'playing' });
      void advance().catch(() => { /* advance reports failure through supplied state. */ });
    },
    pause() {
      playing = false;
      stopTimer();
      playback({ mode: 'paused', response: { kind: 'info', message: snapshot.playback.busy
        ? 'Pausing after the current hour.' : 'Playback paused.' } });
    },
    step: advance,
    reset() {
      if (snapshot.playback.busy) return;
      playing = false;
      failed = false;
      stopTimer();
      supplied.reset();
      simulation.reset();
      observers = new Map(jobs.map(job => [job.id, reportableJob(job.id)]));
      publish(initial(snapshot.playback.speed));
    },
    selectEvent(id: string) {
      if (!snapshot.scenario.events.some(event => event.id === id)) throw new Error('Unknown scenario event.');
      publish({ scenario: { ...snapshot.scenario, selectedEventId: id } });
    },
    applyEvent(input: InputEvent) {
      if (failed) throw new Error('Reset before scheduling another event.');
      const atHour = simulation.hour + (ticking ? 1 : 0);
      if (atHour >= totalHours) throw new Error('This run has no hours remaining. Reset to try another event.');
      const option = scenarioEvents(atHour).find(event => event.input.kind === input.kind);
      if (!option) throw new Error('Unknown scenario event.');
      const scheduled = { ...structuredClone(input), atHour };
      simulation.schedule(scheduled);
      const message = 'Scheduled for ' + timestamp(atHour).slice(11, 16) + ' UTC. Apply it with Step or let Play reach that hour.';
      publish({ events: [...snapshot.events, { input: scheduled, label: option.label, state: 'scheduled', message }] });
      playback({ response: { kind: 'success', message: option.label + ': ' + message } });
    },
    setSpeed(speed: number) { playback({ speed }); },
    inspect(id: string) {
      const entry = snapshot.jobs.find(item => item.job.id === id);
      if (!entry || entry.phase === 'upcoming' || snapshot.playback.busy) return;
      publish({ activeId: id, viewAt: entry.attempts.at(-1)?.asOf ?? entry.job.readyAt,
        routeAttempt: snapshot.routeAttempt + 1 });
    },
    dispose() {
      disposed = true;
      playing = false;
      stopTimer();
      if (dwell) { clearTimeout(dwell.timer); dwell.finish(); }
      listeners.clear();
    },
  };
}
