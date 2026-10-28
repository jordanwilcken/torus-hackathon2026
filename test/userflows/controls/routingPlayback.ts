import { createSimulation } from '../../../src/core/execution/simulation/clock';
import { chooseExecutionSlot } from '../../../src/core/scheduling/chooseExecutionSlot';
import { reportableJob, withReporting } from '../../../src/core/reporting/impact/reportableJob';
import type { Job } from '../../../src/core/jobs/Job.type';
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type';
import type { JobObservations } from '../../../src/core/reporting/JobObservations.type';
import type { PlaybackState } from '../../../src/ui/core/controls/PlaybackControls.types';
import { energy, jobs, routingOptions, startAt, timestamp, totalHours } from './streamScenario';

type Attempt = { asOf: string; outcome: JobOutcome };
export type PlaybackJob = {
  job: Job; phase: 'upcoming' | 'choosing' | 'decided' | 'failed';
  attempts: Attempt[]; observations: JobObservations;
};
type Snapshot = {
  playback: PlaybackState; jobs: PlaybackJob[]; activeId: string;
  viewAt: string; routeAttempt: number;
};

/** Demo composition only: real arrival clock and routing, supplied prices, no executor. */
export function createRoutingPlayback() {
  const listeners = new Set<() => void>();
  let disposed = false;
  let playing = false;
  let failed = false;
  let nextHour: ReturnType<typeof setTimeout> | undefined;
  let dwell: { timer: ReturnType<typeof setTimeout>; finish: () => void } | undefined;
  let snapshot: Snapshot = initial();
  let observers = new Map(jobs.map(job => [job.id, reportableJob(job.id)]));

  function initial(speed = 1): Snapshot {
    return {
      playback: { hour: 0, totalHours, currentTime: startAt, mode: 'paused', speed,
        speedOptions: [1, 2, 4], busy: false,
        condition: { kind: 'healthy', message: 'Real clock and chooser; sample hourly prices.' } },
      jobs: jobs.map(job => ({ job, phase: 'upcoming', attempts: [], observations: { jobId: job.id } })),
      activeId: jobs[0].id, viewAt: startAt, routeAttempt: 0,
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
  }, { energy, createPhases: () => ({
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
    playback({ busy: true, response: undefined });
    try {
      await simulation.step();
      if (disposed) return;
      const complete = simulation.hour === totalHours;
      if (complete) playing = false;
      playback({ hour: simulation.hour, currentTime: timestamp(simulation.hour),
        mode: complete ? 'complete' : playing ? 'playing' : 'paused',
        response: { kind: 'info', message: complete ? 'All sample arrivals reviewed. Inspect any job or Reset to replay.'
          : 'Hour reviewed. Waiting jobs will be reconsidered on the next tick.' } });
    } catch (error) {
      showFailure(error);
      throw error;
    } finally {
      playback({ busy: false });
    }
    if (playing && !disposed) nextHour = setTimeout(() => {
      nextHour = undefined;
      void advance().catch(() => { /* advance reports failure through supplied state. */ });
    }, 900 / snapshot.playback.speed);
  }

  return {
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
      simulation.reset();
      observers = new Map(jobs.map(job => [job.id, reportableJob(job.id)]));
      publish(initial(snapshot.playback.speed));
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
