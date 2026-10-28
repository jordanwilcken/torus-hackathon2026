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
  const demand = eia.snapshot?.observations.filter(item => item.metric === 'demand' && item.value !== null)
    .toSorted((a, b) => a.window.endAt.localeCompare(b.window.endAt)).at(-1);
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
    <div className="fleet-heading"><div><p className="eyebrow">FOLLOW THE ENERGY</p><h2>A moving picture of compute</h2></div>
      <span className="fleet-mode">Modeled execution</span></div>
    {capture ? <FleetSession key={generation} capture={capture} restored={restored} freezeAnchor={freezeAnchor} latestSources={latestSources} onRestore={restoreSaved} /> : <>
      <FleetMap sites={unconnected} transfers={[]} playing={false} onInspect={() => {}} onJob={() => {}} />
      <p className="fleet-empty" role="status">{loadingMoment ? 'Retrieving the frozen moment…' : loadError || (candidate.available ? 'Preparing the fleet…' : candidate.reason)}</p>
    </>}
    <div className="fleet-sources"><small>Latest source context</small><span className={weather.status === 'ready' ? 'connected' : ''}>Open-Meteo · {weather.status}</span>
      <span className={market.status === 'ready' ? 'connected' : ''}>CAISO · {market.status}</span>
      <span>EIA PACE · {eia.status} · {demand?.value != null ? number(demand.value) + ' MW' : 'unavailable'}{demand && ` · ${demand.window.endAt.slice(0, 10)} ${time(demand.window.endAt)}`}</span>
      <button onClick={() => { void weatherClient.refresh(); void grid.caiso.refresh(); void grid.eia.refresh(); }}>Refresh inputs</button>
      {changed && <button onClick={() => { if (candidate.available) { setCapture(candidate.capture); setRestored(undefined); setFreezeAnchor(undefined); setMomentId(''); setGeneration(value => value + 1); const url = new URL(location.href); url.searchParams.delete('capture'); history.replaceState(null, '', url); } }}>Start with latest inputs</button>}
    </div>
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
  const jobReceipts = progress.selected.run.ticks.flatMap(tick => tick.executions).filter(receipt => receipt.jobId === jobId);
  const arrived = progress.selected.finalJobs.filter(job => admissions.some(admission => admission.jobId === job.id));
  const nextSolar = progress.scenario.sites.find(site => site.configuration.locationId === eventSite)?.observations[progress.hour]?.supply?.solarKW ?? 0;
  const failure = progress.selected.run.ticks.find(tick => !tick.feasible);
  const droppedAlready = progress.scenario.events?.some(event => event.atHour === progress.hour && (event.payload as { locationId: string }).locationId === eventSite);
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
  function disrupt() {
    actions.pause();
    try { actions.applyEvent({ atHour: progress.hour, kind: 'solar-drop', payload: { locationId: eventSite } });
      setNotice(`Solar drop scheduled at ${place(eventSite)} for model hour ${progress.hour}. Step or play to see the response.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  return <>
    <div className="fleet-livebar"><div className="fleet-clock"><span className={playback.playing ? 'clock-pulse' : ''} />
      <strong>{failure ? 'Stopped' : progress.done ? 'Horizon complete' : playback.playing ? 'Running model' : 'Paused model'}</strong>
      <output aria-label="Fleet model hour" data-hour={progress.hour}>{progress.hour} / {progress.totalHours} h</output>
      <small>{time(currentAt)} · 1 model hour ≈ {number(5.8 / playback.speed)} s</small></div>
      <button className="fleet-monkey" aria-label="Chaos monkey" aria-expanded={monkey} onClick={() => setMonkey(value => !value)}>🐒 <span>Disrupt</span></button></div>
    <div className="fleet-stage">
      <FleetMap activityEpoch={activityEpoch} sites={sites} transfers={progress.selected.run.transfers} playing={playback.playing}
        admissions={admissions} onOrigin={id => { setOriginId(id); setSelected(undefined); setJobId(undefined); }} selected={selected} onInspect={inspect} onJob={id => { setOriginId(undefined); setJobId(id); setSelected(undefined); }} />
      {(active || job || origin) && <aside className="fleet-inspector">
        <button className="fleet-close" aria-label="Close activity" onClick={() => { setSelected(undefined); setJobId(undefined); setOriginId(undefined); }}>×</button>
        {origin && <section aria-label="Data center activity" data-origin-id={origin.id}><p className="eyebrow">SIMULATED JOB SOURCE</p><h3>{origin.name}</h3>
          <p>{admissions.filter(job => originForJob(job.jobId).id === origin.id).length} simulated submissions</p>
          <p>Publicly documented data-center location. Marker uses a city reference; jobs are generated by this model.</p>
          <a href={origin.sourceUrl} target="_blank" rel="noreferrer">Operator location source</a>
          <div className="fleet-site-jobs">{arrived.filter(job => originForJob(job.id).id === origin.id).slice(-6).map(job => <button key={job.id} onClick={() => { setJobId(job.id); setOriginId(undefined); }}>{job.id}<span>{job.state}</span></button>)}</div>
          <small>No facility workload or telemetry connection.</small>
        </section>}
        {active && <section aria-label="Location activity" data-location-id={active.id} data-hour={progress.hour}>
          <p className="eyebrow">LIVE MODEL STATE</p><h3>{active.name}</h3><p className="fleet-inspect-time">{time(currentAt)} · modeled interval</p>
          <div className="fleet-capacity"><strong>{active.availableGpus}<small> / {active.capacity}</small></strong><span>GPUs for a full hour</span></div>
          <div className="fleet-capacity-bar">{Array.from({ length: active.capacity }, (_, index) => <i key={index} data-free={index < active.availableGpus} />)}</div>
          <dl className="fleet-metrics"><div><dt>Modeled solar</dt><dd><span data-testid="location-solar-kw" data-value={active.solarKW}>{number(active.solarKW)}</span> kW</dd></div>
            <div><dt>Compute used</dt><dd><span data-testid="location-compute-kwh" data-value={activeMeter?.computeKWh ?? 0}>{activeMeter ? number(activeMeter.computeKWh) : 'Pending'}</span>{activeMeter && ' kWh'}</dd></div>
            <div><dt>Stored energy</dt><dd><span data-testid="location-storage-kwh" data-value={active.storedKWh}>{number(active.storedKWh)}</span> / {number(active.storageCapacityKWh)} kWh</dd></div>
            <div><dt>Grid import</dt><dd>{activeMeter ? number(activeMeter.gridImportKWh) + ' kWh' : 'Pending dispatch'}</dd></div></dl>
          <div className="fleet-battery"><i style={{ width: Math.max(0, Math.min(100, active.storageCapacityKWh ? active.storedKWh / active.storageCapacityKWh * 100 : 0)) + '%' }} /></div>
          <p>{active.activeJobs} allocated · {active.queuedJobs} queued</p>
          <small>{progress.scenario.sites.find(site => site.configuration.locationId === active.id)?.regionId} grid context · city reference</small>
          <div className="fleet-site-jobs">{arrived.filter(job => job.currentLocation === active.id || job.transferToLocation === active.id).slice(-5).map(job =>
            <button key={job.id} onClick={() => { setJobId(job.id); setSelected(undefined); setOriginId(undefined); }}>{job.id}<span>{job.state}</span></button>)}</div>
        </section>}
        {job && <section aria-label="Job activity" data-job-id={job.id}><p className="eyebrow">MODELED JOB</p><h3>{job.id}</h3>
          <p>Source: {originForJob(job.id).name} · simulated submission</p><p>{job.state} · {place(job.currentLocation)}{job.transferToLocation && ` → ${place(job.transferToLocation)}`}</p>
          <div className="fleet-work-progress"><i style={{ width: (1 - job.remainingGpuH / job.workGpuH) * 100 + '%' }} /></div>
          <strong>{number(job.workGpuH - job.remainingGpuH)} / {job.workGpuH} GPU-hours</strong>
          <p>Ready {time(job.readyAt)} · deadline {time(job.window.endAt)}</p>
          <p>{progress.selected.decisions.findLast(decision => decision.results.some(result => result.jobId === job.id))?.results.find(result => result.jobId === job.id)?.selection.explanation}</p>
          <small>{jobReceipts.length} executor receipts · {number(jobReceipts.reduce((sum, receipt) => sum + receipt.computeKWh, 0))} modeled compute kWh</small>
        </section>}
      </aside>}
      {monkey && <section className="fleet-chaos" aria-label="Fleet simulation controls"><div><h3>Crash the party</h3><button aria-label="Close controls" onClick={() => setMonkey(false)}>×</button></div>
        <p>Change model inputs. Watch the scheduler respond.</p><div className="fleet-control-row">
          <button onClick={() => void freezeMoment()} disabled={!playback.playing || saving}>Pause</button><button onClick={actions.play} disabled={playback.playing || progress.done || saving}>Play</button>
          <button onClick={() => { actions.pause(); void actions.step(); }} disabled={playback.busy || progress.done || saving}>Step</button>
          <select aria-label="Playback speed" value={playback.speed} onChange={event => actions.setSpeed(Number(event.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
        <label>Disruption location<select aria-label="Disruption location" value={eventSite} onChange={event => setEventSite(event.target.value)}>{progress.scenario.sites.map(site => <option key={site.configuration.locationId} value={site.configuration.locationId}>{site.name ?? site.configuration.locationId}</option>)}</select></label>
        <button className="fleet-drop" onClick={disrupt} disabled={playback.busy || saving || progress.done || nextSolar <= 0 || droppedAlready}>Drop solar</button>
        <small>{nextSolar > 0 ? `Remove ${number(nextSolar)} kW in the next model hour; retain the original forecast.` : 'No solar to remove in the next hour. Choose another site or advance time.'}</small>
        {notice && <p role="status">{notice}</p>}
        <button disabled={saving || playback.busy} onClick={() => void freezeMoment()}>{saving ? 'Saving frozen moment…' : 'Save frozen moment'}</button>
        {savedMoment && <div className="fleet-saved-moment"><small>Capture ID</small><code data-testid="frozen-capture-id">{savedMoment.revision}</code>
          <button onClick={() => void loadFleetMoment(savedMoment.revision).then(onRestore).catch(error => setNotice(error instanceof Error ? error.message : String(error)))}>Restore frozen moment</button></div>}<button onClick={async () => { try { await actions.reset(); setActivityEpoch(value => value + 1); setNotice('Captured starting moment restored. Press Play to continue.'); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } }} disabled={playback.busy}>Reset model</button>
      </section>}
    </div>
    <div className="fleet-work-strip" aria-label="Fleet jobs">{arrived.slice(-12).map(job => <button key={job.id} aria-label={`Inspect ${job.id}`} data-job-state={job.state}
      aria-pressed={jobId === job.id} onClick={() => { setJobId(job.id); setSelected(undefined); setOriginId(undefined); }}><i /><strong>{job.id}</strong><span>{job.state}</span></button>)}</div>
    <div className="fleet-footer"><span>{arrived.length} arrivals · {arrived.filter(job => job.state === 'done').length} completed · {progress.selected.run.transfers.length} transfers</span>
      <small>Captured public inputs · synthetic jobs & assets · accelerated model clock</small><button onClick={() => download(progress)}>Download model evidence</button></div>
    {failure && <p role="alert">Model stopped: {failure.explanation} Partial receipts retained.</p>}
  </>;
}
