import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ChaosMonkeyControls } from '../../../src/ui/core/controls/ChaosMonkeyControls';
import { EnergyMapView } from '../../../src/ui/energy/EnergyMapView';
import { getEnergyMap } from '../../../src/core/energy/getEnergyMap';
import { createJobReport } from '../../../src/core/reporting/getJobReport';
import type { SlotReference } from '../../../src/core/energy/SlotReference.type';
import { createRoutingPlayback, type PlaybackJob } from './routingPlayback';
import { timestamp } from './streamScenario';
import './JobPlayback.css';

const time = (value: string) => value.slice(11, 16) + ' UTC';
function decision(entry: PlaybackJob) {
  if (entry.phase === 'upcoming') return 'Upcoming';
  if (entry.phase === 'choosing') return 'Comparing eligible sites and hours…';
  if (entry.phase === 'failed') return 'Routing failed';
  const attempt = entry.attempts.at(-1)!;
  return attempt.outcome.selected
    ? 'Selected ' + attempt.outcome.allocation.slot.locationId + ' at ' + time(attempt.asOf)
    : (attempt.outcome.explanation.startsWith('Waiting:') ? 'Waiting' : 'No selection') + ' at ' + time(attempt.asOf);
}

export function JobPlayback() {
  const [session] = useState(createRoutingPlayback);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [inspectedSlot, setInspectedSlot] = useState<SlotReference>();
  useEffect(() => () => session.dispose(), [session]);
  const active = state.jobs.find(entry => entry.job.id === state.activeId)!;
  const map = getEnergyMap({ window: { startAt: state.viewAt, endAt: new Date(Date.parse(state.viewAt) + 3_600_000).toISOString() },
    asOf: state.viewAt, locations: active.job.allowedLocations, computeProfile: active.job.computeProfile }, session.energy);
  const priceMap = getEnergyMap({ window: { startAt: timestamp(0), endAt: timestamp(5) },
    asOf: state.viewAt, locations: active.job.allowedLocations, computeProfile: active.job.computeProfile }, session.energy);
  const report = createJobReport(active.observations, { fake: false, label: 'Real chooser · sample slot evidence' });
  const focus = useMemo(() => ({ locationId: active.job.currentLocation, slotId: active.job.currentLocation + '-18' }),
    [active.job.id, active.job.currentLocation]);

  return <main className="job-playback" style={{ '--job-route-duration': `${700 / state.playback.speed}ms` } as CSSProperties}>
    <header className="job-playback-heading"><div>
      <span className="job-playback-kicker">ARRIVE → COMPARE → SELECT → NEXT</span>
      <h1>Job stream playback</h1>
      <p>Open 🐒 and press Play. Follow three jobs through real scheduling decisions, or Step one hour at a time.</p>
    </div><span className="job-playback-badge">Real chooser · sample prices</span></header>
    <div className="job-playback-queue" aria-label="Job arrivals">
      {state.jobs.map(entry => <button key={entry.job.id} type="button" aria-label={'Inspect ' + entry.job.id}
        aria-pressed={state.activeId === entry.job.id} disabled={entry.phase === 'upcoming' || state.playback.busy}
        onClick={() => { setInspectedSlot(undefined); session.inspect(entry.job.id); }}>
        <span><strong>{entry.job.id}</strong><small>Arrives {time(entry.job.readyAt)}</small></span>
        <output aria-label={entry.job.id + ' decision'}>{decision(entry)}</output>
        <small>1 GPU-hour · deadline {time(entry.job.window.endAt)}</small>
      </button>)}
    </div>
    <div className="job-playback-now" role="status">
      <strong>{active.job.id}</strong><span>{decision(active)}</span>
      <span>Map evidence: {time(state.viewAt)}</span>
    </div>
    {state.events.length > 0 && <section className="job-playback-events" aria-label="Scenario events">
      <h2>Scenario events</h2><ol>{state.events.map((event, index) => <li key={index}>
        <strong>{event.label}</strong><span>{event.state === 'applied' ? 'Applied at ' : 'Scheduled for '}{time(timestamp(event.input.atHour))}</span>
        <p>{event.message}</p>
      </li>)}</ol>
    </section>}
    <EnergyMapView map={map} jobFlow={{ job: active.job, report, routeAttempt: state.routeAttempt }}
      inspection={{ inspectedSlot, focusSlot: focus, onInspect: setInspectedSlot }}
      controls={<ChaosMonkeyControls state={state.playback} actions={session} scenario={state.scenario} />} />
    <p className="job-playback-limit">Selections only: capacity is not reserved and work has not executed.</p>
    <section className="job-playback-history" aria-label="Decision history">
      <h2>{active.job.id} · decision history</h2>
      {active.observations.routingFailure && <p role="alert">{active.observations.routingFailure}</p>}
      {active.attempts.length === 0 ? <p>{active.phase === 'upcoming' ? 'Waiting for this job to arrive.' : 'No decision recorded yet.'}</p> : <ol>
        {active.attempts.map(attempt => <li key={attempt.asOf}><time dateTime={attempt.asOf}>{time(attempt.asOf)}</time>
          <p>{attempt.outcome.explanation}</p>
          {attempt.outcome.selected && <span>Chosen window: {time(attempt.outcome.allocation.energy[0].window.startAt)}–{time(attempt.outcome.allocation.energy[0].window.endAt)}</span>}
        </li>)}
      </ol>}
    </section>
    <details className="job-playback-prices"><summary>Inspect supplied hourly prices</summary>
      <p>USD/GPU-hour. Later windows are projections, not reservations. These sample jobs have no transfer data or delay.</p>
      <div className="table-scroll"><table aria-label="Supplied hourly prices"><thead><tr><th>Site</th>
        {[0, 1, 2, 3, 4].map(hour => <th key={hour}>{time(timestamp(hour))}</th>)}
      </tr></thead><tbody>{[...priceMap.sites.values()].map(site => <tr key={site.id}><th>{site.name}</th>
        {[0, 1, 2, 3, 4].map(hour => {
          const slot = site.slots.find(item => item.snapshot.slot?.window.startAt === timestamp(hour))?.snapshot.slot;
          return <td key={hour}>{slot?.postedUsdPerGpuHour.toFixed(2) ?? '—'}</td>;
        })}
      </tr>)}</tbody></table></div>
    </details>
  </main>;
}
