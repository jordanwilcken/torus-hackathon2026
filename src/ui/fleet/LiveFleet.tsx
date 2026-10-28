import { useEffect, useMemo, useState } from 'react';
import { createSiteWeatherClient } from '../../data/createSiteWeatherClient';
import { captureLiveFleet, type FleetCapture } from '../../data/captureLiveFleet';
import { dataCenters, originForJob } from '../../data/dataCenters';
import { modeledSites } from '../../data/modeledSites';
import type { FleetSourceBundle, FrozenFleetSnapshot } from '../../data/FrozenFleet.type';
import { saveFleetMoment, loadFleetMoment, type SavedFleetMoment } from '../../data/fleetMoments';
import { restoreFrozenFleet } from '../replay/restoreFrozenFleet';
import type { createPairedReplaySession } from '../../core/execution/replay/createPairedReplaySession';
import type { PublicGridClient } from '../../data/createPublicGridClient';
import { useFeed } from '../data/useFeed';
import { useReplayPlayback } from '../replay/useReplayPlayback';
import { FleetMap, type FleetSiteVisual } from './FleetMap';
import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import { SourceSignals } from './SourceSignals';
import { FleetSummary } from './FleetSummary';
import { CapacityHorizon, MoveSignal } from './EngineSignals';
import './LiveFleet.css';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const time = (value: string) => value.slice(11, 16) + ' UTC';
const unconnected = modeledSites.map(site => ({ ...site, capacity: 8, availableGpus: 0, solarKW: 0, storedKWh: 0, storageCapacityKWh: 0, activeJobs: 0, queuedJobs: 0, unknown: true }));

export function LiveFleet({ grid }: { grid: PublicGridClient }) {
  const [weatherClient] = useState(() => createSiteWeatherClient());
  const weather = useFeed(weatherClient), market = useFeed(grid.caiso), eia = useFeed(grid.eia);
  const [now, setNow] = useState(Date.now);
  const [capture, setCapture] = useState<FleetCapture>();
  const [generation, setGeneration] = useState(0);
  const [freezeAnchor, setFreezeAnchor] = useState<SavedFleetMoment>();
  const [restored, setRestored] = useState<ReturnType<typeof createPairedReplaySession>>();
  const [requestedCapture] = useState(() => new URLSearchParams(location.search).get('capture'));
  const [loadingMoment, setLoadingMoment] = useState(Boolean(requestedCapture));
  const [loadError, setLoadError] = useState('');
  const [momentId, setMomentId] = useState(requestedCapture ?? '');
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const candidate = useMemo(() => captureLiveFleet(weather, market, now), [weather, market, now]);
  useEffect(() => { if (!capture && !requestedCapture && candidate.available) setCapture(candidate.capture); }, [capture, candidate, requestedCapture]);
  const changed = capture && candidate.available && candidate.capture.scenario.inputRevision !== capture.scenario.inputRevision;
  async function restoreSaved(saved: SavedFleetMoment) {
    const session = await restoreFrozenFleet(saved.capture);
    const sources = saved.capture.runInputs;
    if (!sources.weather || !sources.caiso) throw new Error('Frozen moment is missing its original public inputs.');
    const price = sources.caiso.snapshot.prices.filter(point => Date.parse(point.window.startAt) <= Date.parse(sources.capturedAt)).at(-1);
    if (!price) throw new Error('Frozen moment has no original reference market price.');
    setCapture({ scenario: saved.capture.progress.scenario, runInputs: sources, weatherRevision: sources.weather.revision,
      priceRevision: sources.caiso.revision, capturedAt: sources.capturedAt, price });
    setRestored(session); setFreezeAnchor(saved); setGeneration(value => value + 1); setMomentId(saved.revision); setLoadError('');
    const url = new URL(location.href); url.searchParams.set('capture', saved.revision); history.replaceState(null, '', url);
  }
  useEffect(() => {
    if (!requestedCapture) return;
    let active = true;
    void loadFleetMoment(requestedCapture).then(async saved => { if (active) await restoreSaved(saved); })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setLoadingMoment(false); });
    return () => { active = false; };
  }, [requestedCapture]);
  function latestSources(): FleetSourceBundle {
    const publication = <T,>(feed: { getSnapshot(): { snapshot: T | null; revision: string | null; status: string } }) => {
      const state = feed.getSnapshot();
      return state.snapshot && state.revision ? { revision: state.revision, snapshot: structuredClone(state.snapshot),
        status: state.status === 'ready' ? 'ready' as const : 'stale' as const } : null;
    };
    return { capturedAt: new Date().toISOString(), weather: publication(weatherClient), caiso: publication(grid.caiso), eia: publication(grid.eia) };
  }
  return <section className="live-fleet" aria-label="Live input fleet">
    <div className="fleet-heading"><div className="fleet-heading-label"><h2>Live fleet</h2><span className="fleet-mode">Modeled execution</span></div>
      <SourceSignals weather={weather} market={market} eia={eia} capture={capture} now={now} onRefresh={() => { void weatherClient.refresh(); void grid.caiso.refresh(); void grid.eia.refresh(); }} />
    </div>
    {capture ? <FleetSession key={generation} capture={capture} restored={restored} freezeAnchor={freezeAnchor} latestSources={latestSources} onRestore={restoreSaved} /> : <>
      <FleetMap sites={unconnected} transfers={[]} playing={false} onInspect={() => {}} onJob={() => {}} />
      <p className="fleet-empty" role="status">{loadingMoment ? 'Retrieving the frozen moment…' : loadError || (candidate.available ? 'Preparing the fleet…' : candidate.reason)}</p>
    </>}
    {changed && <div className="fleet-new-input"><span>New public inputs available</span><button onClick={() => { if (candidate.available) { setCapture(candidate.capture); setRestored(undefined); setFreezeAnchor(undefined); setMomentId(''); setGeneration(value => value + 1); const url = new URL(location.href); url.searchParams.delete('capture'); history.replaceState(null, '', url); } }}>Start with latest inputs</button></div>}
    <details className="fleet-provenance"><summary>Retrieve a frozen moment</summary>
      <label>Capture ID <input aria-label="Frozen capture ID" value={momentId} onChange={event => setMomentId(event.target.value)} /></label>
      <button disabled={loadingMoment} onClick={async () => { setLoadingMoment(true); try { await restoreSaved(await loadFleetMoment(momentId)); }
        catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); } finally { setLoadingMoment(false); } }}>Retrieve frozen moment</button>
      {loadError && <p role="alert">{loadError}</p>}<p>Retrieves the exact public input bundle and replays it to the saved paused state. New source readings stay separate.</p>
    </details>
    <details className="fleet-provenance"><summary>Sources & model assumptions</summary>
      <p><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a> supplies site-specific radiation forecasts; retrieved {weather.snapshot?.retrievedAt ?? 'unavailable'}.
        {' '}<a href="https://oasis.caiso.com" target="_blank" rel="noreferrer">CAISO</a> supplies a PACE reference wholesale price, not local tariffs for these six sites.
        {' '}<a href="https://www.eia.gov/opendata/" target="_blank" rel="noreferrer">EIA</a> demand is regional context, never spare site capacity.</p>
      <p>City coordinates identify modeled assets, not accessible data centers. Each has 8 modeled GPUs at 0.4 kW, an 8 kW solar array at 0.8 performance ratio,
        1.5 kW grid import, 0.2 kW fixed load and 2 kWh storage initially containing 0.6 kWh. Storage charge/discharge efficiency is 90% each.
        Solar is radiation × array size × performance ratio. Jobs are declared synthetic arrivals; transfers assume 1 GB/hour, 0.01 kWh/GB and $0.001/GB.</p>
      <p>All sites share the captured CAISO reference price throughout this 24-hour model. Carbon inputs are assumptions: grid 400 g/kWh, solar 40 g/kWh; carbon price is zero.
        Public inputs remain pinned to the displayed run. New captures can start a new run; zoom and inspection never reset it. No measured site power or remote GPU execution is claimed.</p>
      {capture && <p>Captured {capture.capturedAt}. Weather revision <code>{capture.weatherRevision}</code>. Price revision <code>{capture.priceRevision}</code>.
        Price ${number(capture.price.usdPerMWh)}/MWh · {time(capture.price.window.startAt)}–{time(capture.price.window.endAt)}.</p>}
      {!candidate.available && capture && <p role="status">Source freshness: {candidate.reason} This running model retains its original capture.</p>}
    </details>
  </section>;
}

function download(progress: ReplayProgress) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...progress, jobOrigins: progress.scenario.jobs.map(job => originForJob(job.id)) }, (_, value) => value instanceof Map ? Object.fromEntries(value) : value, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `fleet-${progress.hour}-evidence.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function nextSolarDisruption(progress: ReplayProgress, locationId: string) {
  const site = progress.scenario.sites.find(item => item.configuration.locationId === locationId);
  const atHour = site?.observations.findIndex((input, hour) => hour >= progress.hour && (input.supply?.solarKW ?? 0) > 0
    && !progress.scenario.events?.some(event => event.kind === 'solar-drop' && event.atHour === hour
      && (event.payload as { locationId: string }).locationId === locationId)) ?? -1;
  if (!site || atHour < 0 || progress.done) return undefined;
  const input = site.observations[atHour];
  return { atHour, solarKW: input.supply!.solarKW, startAt: input.window.startAt };
}
function FleetSession({ capture, restored, freezeAnchor, latestSources, onRestore }: {
  capture: FleetCapture; restored?: ReturnType<typeof createPairedReplaySession>; freezeAnchor?: SavedFleetMoment;
  latestSources: () => FleetSourceBundle; onRestore: (saved: SavedFleetMoment) => Promise<void>;
}) {
  const playback = useReplayPlayback(capture.scenario, { session: restored, autoPlay: !restored, tickMs: 4000, routedDwellMs: 1800 });
  const { progress, actions } = playback;
  const place = (id: string) => progress.scenario.sites.find(site => site.configuration.locationId === id)?.name ?? id;
  const [selected, setSelected] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const [originId, setOriginId] = useState<string>();
  const [monkey, setMonkey] = useState(false);
  const [eventSite, setEventSite] = useState('A');
  const [notice, setNotice] = useState('');
  const [activityEpoch, setActivityEpoch] = useState(0);
  const [savedMoment, setSavedMoment] = useState<SavedFleetMoment | undefined>(freezeAnchor);
  const [saving, setSaving] = useState(false);
  const [preparingDisruption, setPreparingDisruption] = useState(false);
  const latestDecision = progress.selected.decisions.at(-1);
  const displayHour = latestDecision?.hour ?? 0;
  const currentAt = new Date(Date.parse(progress.scenario.startAt) + displayHour * 3_600_000).toISOString();
  const currentTick = progress.selected.run.ticks.find(tick => tick.meters[0]?.window.startAt === currentAt);
  const sites: FleetSiteVisual[] = progress.scenario.sites.map(definition => {
    const reference = { id: definition.configuration.locationId, name: definition.name ?? definition.configuration.locationId, latitude: definition.lat ?? NaN, longitude: definition.lng ?? NaN };
    const compute = definition.configuration.compute;
    const input = definition.observations[displayHour];
    const dropped = progress.scenario.events?.some(event => event.atHour === displayHour && (event.payload as { locationId: string }).locationId === reference.id);
    const reading = progress.map.sites.get(reference.id)?.slots.find(slot => slot.snapshot.slot?.window.startAt === currentAt)?.snapshot.slot;
    const allocations = latestDecision?.results.filter(result => result.accepted && result.selection.selected && result.selection.allocation.slot.locationId === reference.id) ?? [];
    const allocated = allocations.reduce((total, result) => total + (result.selection.selected ? result.selection.allocation.allocatedGpus : 0), 0);
    const meter = currentTick?.meters.find(meter => meter.locationId === reference.id);
    const priorMeter = progress.selected.run.ticks.flatMap(tick => tick.meters).findLast(meter => meter.locationId === reference.id);
    const supported = reading ? Math.min(reading.capGpus, Math.floor(reading.availablePowerKW / compute.kWPerGpu), Math.floor(reading.availableEnergyKWh / compute.kWPerGpu)) : 0;
    return { ...reference, capacity: compute.capGpus, storageCapacityKWh: definition.configuration.storage.limits.capacityKWh, availableGpus: Math.max(0, supported - (progress.phase === 'routed' ? allocated : 0)),
      solarKW: meter?.solarKWh ?? (dropped ? 0 : input.supply?.solarKW ?? 0),
      storedKWh: priorMeter?.endingStoredKWh ?? definition.configuration.storage.initial.storedKWh,
      activeJobs: progress.phase === 'routed' ? allocations.length : 0, queuedJobs: progress.selected.finalJobs.filter(job => job.currentLocation === reference.id && job.state === 'queued' && job.readyAt <= currentAt).length,
      unknown: !reading && !meter };
  });
  const origin = dataCenters.find(site => site.id === originId);
  const admissions = [...new Set(progress.selected.decisions.flatMap(decision => decision.results.map(result => result.jobId)))].map(jobId => ({ jobId, homeLocation: progress.scenario.jobs.find(job => job.id === jobId)!.homeLocation }));
  const active = sites.find(site => site.id === selected);
  const activeMeter = currentTick?.meters.find(meter => meter.locationId === selected);
  const job = progress.selected.finalJobs.find(job => job.id === jobId);
  const movement = progress.selected.decisions.findLast(decision => decision.results.some(result => result.jobId === jobId))?.results.find(result => result.jobId === jobId)?.selection.movement;
  const jobReceipts = progress.selected.run.ticks.flatMap(tick => tick.executions).filter(receipt => receipt.jobId === jobId);
  const arrived = progress.selected.finalJobs.filter(job => admissions.some(admission => admission.jobId === job.id));
  const disruptionOptions = progress.scenario.sites.map(site => ({
    id: site.configuration.locationId, name: site.name ?? site.configuration.locationId,
    next: nextSolarDisruption(progress, site.configuration.locationId),
  }));
  const disruption = disruptionOptions.find(option => option.id === eventSite)?.next;
  const failure = progress.selected.run.ticks.find(tick => !tick.feasible);
  function inspect(id: string) { setOriginId(undefined); setSelected(id); setJobId(undefined); setEventSite(id); }
  async function freezeMoment() {
    setSaving(true);
    try {
      await actions.pause();
      const { map: _derivedMap, ...frozenProgress } = playback.read();
      const snapshot: FrozenFleetSnapshot = { schemaVersion: 1, capturedAt: new Date().toISOString(),
        runInputs: capture.runInputs, latestContext: latestSources(), progress: frozenProgress };
      const saved = await saveFleetMoment(snapshot);
      setSavedMoment(saved); setNotice('Frozen moment saved. Stress tests use this run’s captured inputs; newer public readings remain separate.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  async function openDisruption() {
    if (monkey) { setMonkey(false); return; }
    setMonkey(true); setPreparingDisruption(true);
    try {
      await actions.pause();
      const settled = playback.read();
      const choices = settled.scenario.sites.map(site => ({ id: site.configuration.locationId,
        next: nextSolarDisruption(settled, site.configuration.locationId) }));
      const preferred = choices.find(option => option.id === eventSite && option.next?.atHour === settled.hour)
        ?? choices.filter(option => option.next).toSorted((a, b) => a.next!.atHour - b.next!.atHour)[0];
      if (preferred) setEventSite(preferred.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setPreparingDisruption(false); }
  }
  async function disrupt() {
    setPreparingDisruption(true);
    try {
      await actions.pause();
      const target = nextSolarDisruption(playback.read(), eventSite);
      if (!target) throw new Error('No remaining sunny hour at this site. Choose another site or reset the model.');
      actions.applyEvent({ atHour: target.atHour, kind: 'solar-drop', payload: { locationId: eventSite } });
      setNotice('Solar drop scheduled at ' + place(eventSite) + ' for model hour ' + target.atHour + ' (' + time(target.startAt) + '). Step or play to reach it. Captured forecast unchanged.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setPreparingDisruption(false); }
  }
  return <>
    <div className="fleet-livebar"><div className="fleet-clock"><span className={playback.playing ? 'clock-pulse' : ''} />
      <strong>{failure ? 'Stopped' : progress.done ? 'Horizon complete' : playback.playing ? 'Running model' : 'Paused model'}</strong>
      <output aria-label="Fleet model hour" data-hour={progress.hour}>{progress.hour} / {progress.totalHours} h</output>
      <small>{time(currentAt)} · 1 model hour ≈ {number(5.8 / playback.speed)} s</small></div>
      <button className="fleet-monkey" aria-label="Chaos monkey" aria-expanded={monkey} onClick={() => void openDisruption()}>🐒 <span>Disrupt</span></button></div>
    <FleetSummary progress={progress} />
    <div className="fleet-stage">
      <FleetMap activityEpoch={activityEpoch} sites={sites} transfers={progress.selected.run.transfers} playing={playback.playing}
        admissions={admissions} onOrigin={id => { setOriginId(id); setSelected(undefined); setJobId(undefined); }} selected={selected} onInspect={inspect} onJob={id => { setOriginId(undefined); setJobId(id); setSelected(undefined); }} />
      {(active || job || origin) && <aside className="fleet-inspector">
        <button className="fleet-close" aria-label="Close activity" onClick={() => { setSelected(undefined); setJobId(undefined); setOriginId(undefined); }}>×</button>
        {origin && <section aria-label="Data center activity" data-origin-id={origin.id}><p className="eyebrow">DATA CENTER · SIMULATED JOB SOURCE</p><h3>{origin.name}</h3>
          <p>{admissions.filter(job => originForJob(job.jobId).id === origin.id).length} simulated submissions</p>
          <p className="fleet-origin-note">Public location · generated GPU batches</p>
          <a href={origin.sourceUrl} target="_blank" rel="noreferrer">Operator location source</a>
          <div className="fleet-site-jobs">{arrived.filter(job => originForJob(job.id).id === origin.id).slice(-6).map(job => <button key={job.id} onClick={() => { setJobId(job.id); setOriginId(undefined); }}>{job.id}<span>{job.state}</span></button>)}</div>
          <small>No facility workload or telemetry connection.</small>
        </section>}
        {active && <section aria-label="Location activity" data-location-id={active.id} data-hour={progress.hour}>
          <p className="eyebrow">ENERGY SITE · MODELED</p><h3>{active.name}</h3><p className="fleet-inspect-time">{time(currentAt)} · {progress.scenario.sites.find(site => site.configuration.locationId === active.id)?.regionId}</p>
          <div className="fleet-capacity"><strong>{active.availableGpus}<small> / {active.capacity}</small></strong><span>GPUs for a full hour</span></div>
          <div className="fleet-capacity-bar">{Array.from({ length: active.capacity }, (_, index) => <i key={index} data-free={index < active.availableGpus} />)}</div>
          <CapacityHorizon plan={progress.selected.plans?.at(-1)} locationId={active.id} />
          <dl className="fleet-metrics"><div><dt><i className="energy-key solar" />Solar</dt><dd><span data-testid="location-solar-kw" data-value={active.solarKW}>{number(active.solarKW)}</span> kW</dd></div>
            <div><dt><i className="energy-key compute" />GPU energy</dt><dd><span data-testid="location-compute-kwh" data-value={activeMeter?.computeKWh ?? 0}>{activeMeter ? number(activeMeter.computeKWh) : 'Pending'}</span>{activeMeter && ' kWh'}</dd></div>
            <div><dt><i className="energy-key battery" />Stored</dt><dd><span data-testid="location-storage-kwh" data-value={active.storedKWh}>{number(active.storedKWh)}</span> / {number(active.storageCapacityKWh)} kWh</dd></div>
            <div><dt><i className="energy-key grid" />Grid</dt><dd>{activeMeter ? number(activeMeter.gridImportKWh) + ' kWh' : 'Pending dispatch'}</dd></div></dl>
          <div className="fleet-battery"><i style={{ width: Math.max(0, Math.min(100, active.storageCapacityKWh ? active.storedKWh / active.storageCapacityKWh * 100 : 0)) + '%' }} /></div>
          <div className="fleet-carbon-readout"><span>Carbon · this hour</span><strong>{activeMeter ? activeMeter.carbonKg === undefined ? 'Unknown' : number(activeMeter.carbonKg * 1000) + ' g' : 'Pending'}</strong></div>
          <p className="fleet-active-count">{active.activeJobs} allocated · {active.queuedJobs} queued</p>
          <small>Modeled energy & carbon · city reference</small>
          <div className="fleet-site-jobs">{arrived.filter(job => job.currentLocation === active.id || job.transferToLocation === active.id).slice(-5).map(job =>
            <button key={job.id} onClick={() => { setJobId(job.id); setSelected(undefined); setOriginId(undefined); }}>{job.id}<span>{job.state}</span></button>)}</div>
        </section>}
        {job && <section aria-label="Job activity" data-job-id={job.id}><p className="eyebrow">GPU BATCH · SYNTHETIC WORKLOAD</p><h3>{job.id}<span className="fleet-job-status">{job.state}</span></h3>
          <div className="fleet-job-route"><span><small>SUBMITTED FROM</small>{originForJob(job.id).name}</span><i aria-hidden="true">↓</i><span><small>EXECUTION SITE · MODELED</small>{place(job.currentLocation)}{job.transferToLocation && ' → ' + place(job.transferToLocation)}</span></div>
          <div className="fleet-job-progress-label"><strong>{Math.round((1 - job.remainingGpuH / job.workGpuH) * 100)}%</strong><span>{number(job.workGpuH - job.remainingGpuH)} / {job.workGpuH} GPU·h</span></div>
          <div className="fleet-work-progress"><i style={{ width: (1 - job.remainingGpuH / job.workGpuH) * 100 + '%' }} /></div>
          <div className="fleet-job-timing"><span><small>READY</small>{time(job.readyAt)}</span><span><small>DEADLINE</small>{time(job.window.endAt)}</span></div>
          <div className="fleet-carbon-readout"><span>GPU energy used</span><strong>{number(jobReceipts.reduce((sum, receipt) => sum + receipt.computeKWh, 0))} kWh</strong></div>
          <MoveSignal decision={movement} destinationName={movement && place(movement.destinationLocationId)} />
          <details className="fleet-job-why"><summary>Why this schedule?</summary><p>{progress.selected.decisions.findLast(decision => decision.results.some(result => result.jobId === job.id))?.results.find(result => result.jobId === job.id)?.selection.explanation}</p><small>{jobReceipts.length} executor receipts · carbon counted in site totals</small></details>
        </section>}
      </aside>}
      {monkey && <section className="fleet-chaos" aria-label="Fleet simulation controls"><div><h3>Crash the party</h3><button aria-label="Close controls" onClick={() => setMonkey(false)}>×</button></div>
        <p>Change model inputs. Watch the scheduler respond.</p><div className="fleet-control-row">
          <button onClick={() => void freezeMoment()} disabled={!playback.playing || saving}>Pause</button><button onClick={actions.play} disabled={playback.playing || progress.done || saving || preparingDisruption}>Play</button>
          <button onClick={() => { actions.pause(); void actions.step(); }} disabled={playback.busy || progress.done || saving || preparingDisruption}>Step</button>
          <select aria-label="Playback speed" value={playback.speed} onChange={event => actions.setSpeed(Number(event.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
        <label>Disruption location<select aria-label="Disruption location" value={eventSite} disabled={preparingDisruption || saving} onChange={event => setEventSite(event.target.value)}>{disruptionOptions.map(option => <option key={option.id} value={option.id} disabled={!option.next}>{option.name}{option.next ? ' · ' + number(option.next.solarKW) + ' kW at ' + time(option.next.startAt) : ' · no remaining solar'}</option>)}</select></label>
        <div className="fleet-disruption-target" aria-live="polite">{preparingDisruption ? 'Pausing at a settled model hour…'
          : progress.done ? 'Horizon complete. Reset the model below to try a disruption.'
            : disruption ? <><strong>{number(disruption.solarKW)} kW → 0 kW</strong><span>Model hour {disruption.atHour} · {time(disruption.startAt)}{disruption.atHour > progress.hour ? ' · next sunny hour' : ' · next step'}</span></>
              : 'No sunny hours remain at this site. Choose another city or reset the model.'}</div>
        <button className="fleet-drop" onClick={() => void disrupt()} disabled={preparingDisruption || saving || !disruption}>Drop solar</button>
        <small>Only modeled realized solar changes. Both policies keep the captured forecast. Step or play to the displayed hour.</small>
        {notice && <p role="status">{notice}</p>}
        <button disabled={saving || playback.busy} onClick={() => void freezeMoment()}>{saving ? 'Saving frozen moment…' : 'Save frozen moment'}</button>
        {savedMoment && <div className="fleet-saved-moment"><small>Capture ID</small><code data-testid="frozen-capture-id">{savedMoment.revision}</code>
          <button onClick={() => void loadFleetMoment(savedMoment.revision).then(onRestore).catch(error => setNotice(error instanceof Error ? error.message : String(error)))}>Restore frozen moment</button></div>}<button onClick={async () => { try { await actions.reset(); setActivityEpoch(value => value + 1); setNotice('Captured starting moment restored. Press Play to continue.'); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } }} disabled={playback.busy}>Reset model</button>
      </section>}
    </div>
    <div className="fleet-work-strip" aria-label="Fleet jobs">{arrived.slice(-12).map(job => <button key={job.id} aria-label={`Inspect ${job.id}`} data-job-state={job.state}
      aria-pressed={jobId === job.id} onClick={() => { setJobId(job.id); setSelected(undefined); setOriginId(undefined); }}><i /><small className="fleet-work-kind">GPU</small><strong>{job.id}</strong><span>{job.state}</span></button>)}</div>
    <div className="fleet-footer"><span>{arrived.length} arrivals · {arrived.filter(job => job.state === 'done').length} completed · {progress.selected.run.transfers.length} transfers</span>
      <small>GPU batches · simulated sites · public input snapshot</small><button onClick={() => download(progress)}>Download model evidence</button></div>
    {failure && <p role="alert">Model stopped: {failure.explanation} Partial receipts retained.</p>}
  </>;
}
