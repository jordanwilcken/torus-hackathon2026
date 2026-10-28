import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JobPlayback } from './JobPlayback';
import { PlaybackControls } from '../../../src/ui/core/controls/PlaybackControls';
import { ChaosMonkeyControls } from '../../../src/ui/core/controls/ChaosMonkeyControls';
import { EnergyMapView } from '../../../src/ui/energy/EnergyMapView';
import { getFakeEnergyMap } from '../../fixtures/legacy/energy/fakeEnergyMap';
import { getFakeJob } from '../../fixtures/legacy/jobs/getFakeJob';
import { createJobReport } from '../../../src/core/reporting/getJobReport';
import type { SlotReference } from '../../../src/core/energy/SlotReference.type';
import '../../../src/style.css';
import type {
  PlaybackActions, PlaybackState, ScenarioEventOption, ScenarioMenu,
} from '../../../src/ui/core/controls/PlaybackControls.types';
import type { InputEvent } from '../../../src/core/execution/simulation/clock';

/** Supplied controller responses exercise the view; this fixture runs no simulation algorithms. */
const initialState: PlaybackState = {
  hour: 0,
  totalHours: 24,
  currentTime: '2026-10-28T12:00:00Z',
  mode: 'paused',
  speed: 1,
  speedOptions: [1, 2, 4],
  busy: false,
  condition: { kind: 'healthy', message: 'Supplied inputs are current.' },
};

const events: readonly ScenarioEventOption[] = [
  {
    id: 'forecast-error', label: 'Forecast error', description: 'Supply a changed regional forecast.',
    input: { atHour: 2, kind: 'forecast-error', payload: { regionalScope: 'PACE', carbonMultiplier: 1.4 } },
  },
  {
    id: 'site-outage', label: 'Site outage', description: 'Supply an unavailable site.',
    input: { atHour: 2, kind: 'site-outage', payload: { locationId: 'utah-solar' } },
  },
  {
    id: 'utility-import-limit', label: 'Utility import limit', description: 'Supply a changed import limit.',
    input: { atHour: 2, kind: 'utility-import-limit', payload: { locationId: 'utah-grid', limitKW: 2 } },
  },
  {
    id: 'reserve-change', label: 'Protected reserve change', description: 'Supply a changed protected reserve.',
    input: { atHour: 2, kind: 'reserve-change', payload: { locationId: 'utah-solar', protectedKWh: 3 } },
  },
];

const view = new URLSearchParams(location.search).get('view');
const mapJob = getFakeJob();
const mapReading = getFakeEnergyMap({
  window: mapJob.window, asOf: mapJob.readyAt,
  locations: mapJob.allowedLocations, computeProfile: mapJob.computeProfile,
});
const mapReport = createJobReport({ jobId: mapJob.id }, { fake: true, label: 'Supplied map preview' });

type CommandCall = { action: string; input?: unknown };
export type PlaybackFixture = {
  setState(patch: Partial<PlaybackState>): void;
  emptyEvents(): void;
  holdNextStep(): void;
  releaseStep(): void;
  holdNextPlay(): void;
  releasePlay(): void;
  suppressNextStateUpdate(): void;
  rejectNextCommand(): void;
  calls(): CommandCall[];
};

declare global {
  interface Window { playbackFixture: PlaybackFixture }
}

function Fixture() {
  const [state, setState] = useState<PlaybackState>(initialState);
  const [scenario, setScenario] = useState<ScenarioMenu>({ events, selectedEventId: events[0].id });
  const [journal, setJournal] = useState<CommandCall[]>([]);
  const [inspectedSlot, setInspectedSlot] = useState<SlotReference>();
  // The holder survives React renders without owning any simulation state or timer.
  const [commands] = useState(() => ({
    calls: [] as CommandCall[],
    holdStep: false,
    holdPlay: false,
    suppressStateUpdate: false,
    rejectNext: false,
    release: undefined as (() => void) | undefined,
    releasePlay: undefined as (() => void) | undefined,
  }));

  function record(action: string, input?: unknown): void {
    const call: CommandCall = input === undefined ? { action } : { action, input: structuredClone(input) };
    commands.calls.push(call);
    setJournal([...commands.calls]);
    if (commands.rejectNext) {
      commands.rejectNext = false;
      throw new Error('The supplied command failed.');
    }
  }

  const actions: PlaybackActions = {
    async play() {
      record('play');
      setState(current => ({ ...current, mode: 'playing', response: { kind: 'info', message: 'Playback started.' } }));
      if (commands.holdPlay) {
        commands.holdPlay = false;
        await new Promise<void>(resolve => { commands.releasePlay = resolve; });
        commands.releasePlay = undefined;
      }
    },
    pause() {
      record('pause');
      setState(current => ({ ...current, mode: 'paused', response: { kind: 'info', message: 'Playback paused.' } }));
    },
    async step() {
      record('step');
      if (commands.holdStep) {
        commands.holdStep = false;
        await new Promise<void>(resolve => { commands.release = resolve; });
        commands.release = undefined;
      }
      if (commands.suppressStateUpdate) {
        commands.suppressStateUpdate = false;
        return;
      }
      setState(current => {
        const hour = current.hour + 1;
        return {
          ...current, hour,
          currentTime: new Date(Date.parse(initialState.currentTime) + hour * 3_600_000).toISOString(),
          response: { kind: 'success', message: 'Advanced to hour ' + hour + '.' },
        };
      });
    },
    reset() {
      record('reset');
      setState({ ...initialState, response: { kind: 'success', message: 'Reset fixture.' } });
    },
    setSpeed(speed: number) {
      record('setSpeed', speed);
      setState(current => ({ ...current, speed, response: { kind: 'info', message: 'Speed changed.' } }));
    },
    selectEvent(id: string) {
      record('selectEvent', id);
      setScenario(current => ({ ...current, selectedEventId: id }));
    },
    applyEvent(input: InputEvent) {
      record('applyEvent', input);
      setState(current => ({ ...current, response: {
        kind: 'success', message: 'Accepted event ' + input.kind + ' for hour ' + input.atHour + '.',
      } }));
    },
  };

  window.playbackFixture = {
    setState: patch => setState(current => ({ ...current, ...patch })),
    emptyEvents: () => setScenario({ events: [], selectedEventId: '' }),
    holdNextStep: () => { commands.holdStep = true; },
    releaseStep: () => {
      if (!commands.release) throw new Error('There is no pending fixture step.');
      commands.release();
    },
    holdNextPlay: () => { commands.holdPlay = true; },
    releasePlay: () => {
      if (!commands.releasePlay) throw new Error('There is no pending fixture Play command.');
      commands.releasePlay();
    },
    suppressNextStateUpdate: () => { commands.suppressStateUpdate = true; },
    rejectNextCommand: () => { commands.rejectNext = true; },
    calls: () => structuredClone(commands.calls),
  };

  return <main>
    <h1>{view === 'controls' ? 'Playback controls component fixture' : 'Map controls preview'}</h1>
    <p>Sample state and callback responses. This page does not execute jobs or model energy.</p>
    {view === 'controls' ? <PlaybackControls state={state} actions={actions} scenario={scenario} />
      : <EnergyMapView map={mapReading} jobFlow={{ job: mapJob, report: mapReport, routeAttempt: 0 }}
          inspection={{ inspectedSlot, onInspect: setInspectedSlot }}
          controls={view === 'map-only' ? undefined : <ChaosMonkeyControls state={state} actions={actions} scenario={scenario} />} />}
    <aside aria-label="Fixture callback observations">
      <h2>Fixture callback observations</h2>
      <output aria-label="Callback journal">{JSON.stringify(journal)}</output>
    </aside>
  </main>;
}

const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; }
  body { margin: 0; color: #203833; background: #f2f5f2; font-family: 'Segoe UI', sans-serif; }
  main { max-width: 1180px; min-width: 0; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.4rem; }
  p { line-height: 1.5; }
  aside { margin-top: 24px; padding: 16px; border: 1px solid #cbd5cc; border-radius: 8px; }
  aside h2 { font-size: 1rem; }
  aside output { display: block; overflow-wrap: anywhere; font: 12px/1.5 monospace; }
`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(view === null || view === 'stream' ? <JobPlayback /> : <Fixture />);
