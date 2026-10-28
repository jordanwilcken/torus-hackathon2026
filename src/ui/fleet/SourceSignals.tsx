import { useId, useRef, useState } from 'react';
import type { EiaApiSnapshot } from '../../core/energy/data/eiaApi';
import type { TimeWindow } from '../../core/TimeWindow.type';
import type { FleetCapture } from '../../data/captureLiveFleet';
import type { FeedState } from '../../data/FeedState.type';
import type { CapturedSource } from '../../data/FrozenFleet.type';
import type { SiteWeatherSnapshot } from '../../data/SiteWeather.type';
import type { CaisoSnapshot } from '../../server/caiso';
import { LiveGridReadings } from '../energy/LiveGridInputs';
import { WeatherHistory } from './WeatherHistory';
import './SourceSignals.css';

type SourceId = 'weather' | 'market' | 'eia';
type Snapshot = SiteWeatherSnapshot | CaisoSnapshot | EiaApiSnapshot;
type Reading = { value: string; window?: TimeWindow; available: boolean; note: string; cities?: Array<{ name: string; value: string }> };
type Signal = {
  id: SourceId; name: string; role: string; url: string; feed: FeedState<Snapshot>; reading: Reading;
  pinned?: CapturedSource<Snapshot> & { reading: Reading };
};
export type SourceSignalsProps = {
  weather: FeedState<SiteWeatherSnapshot>;
  market: FeedState<CaisoSnapshot>;
  eia: FeedState<EiaApiSnapshot>;
  capture?: FleetCapture;
  now: number;
  onRefresh: () => void | Promise<unknown>;
};
const hour = 3_600_000;
const formatNumber = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const utc = (value: string) => value.slice(0, 19).replace('T', ' ') + ' UTC';
const interval = (window: TimeWindow) => `${utc(window.startAt)} – ${utc(window.endAt)}`;

function receivedAge(retrievedAt: string | undefined, now: number): string {
  const elapsed = retrievedAt ? now - Date.parse(retrievedAt) : NaN;
  if (!Number.isFinite(elapsed)) return 'Age unknown';
  if (elapsed < -60_000) return 'Check source clock';
  if (elapsed < 60_000) return 'Received just now';
  const minutes = Math.floor(elapsed / 60_000);
  return `Received ${minutes < 60 ? `${minutes}m` : minutes < 1_440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1_440)}d`} ago`;
}

function weatherReading(snapshot: SiteWeatherSnapshot | null, at: number): Reading {
  const sites = snapshot?.sites ?? [];
  const site = sites.find(item => item.locationId === 'A');
  const ordered = site?.intervals.toSorted((a, b) => a.window.startAt.localeCompare(b.window.startAt)) ?? [];
  const point = ordered.find(item => Date.parse(item.window.endAt) > at) ?? ordered.at(-1);
  const value = (radiation: number | null | undefined) => radiation == null ? 'Unavailable' : `${formatNumber(radiation)} W/m²`;
  return {
    value: value(point?.shortwaveRadiationWm2), window: point?.window,
    available: point?.shortwaveRadiationWm2 != null,
    note: `Salt Lake City reference · ${sites.length} site forecasts · preceding-hour average radiation`,
    cities: ([['A', 'Salt Lake City'], ['B', 'Cedar City']] as const).map(([id, name]) => ({
      name, value: value(sites.find(item => item.locationId === id)?.intervals.find(item => item.window.startAt === point?.window.startAt)?.shortwaveRadiationWm2),
    })),
  };
}

function marketReading(snapshot: CaisoSnapshot | null, at: number, pinnedPrice?: CaisoSnapshot['prices'][number]): Reading {
  const point = pinnedPrice ?? snapshot?.prices.filter(item => Date.parse(item.window.startAt) <= at)
    .toSorted((a, b) => a.window.startAt.localeCompare(b.window.startAt)).at(-1);
  return { value: point ? `${point.usdPerMWh.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/MWh` : 'Unavailable', window: point?.window,
    available: !!point, note: 'PACE reference · five-minute wholesale price, not a site tariff' };
}

function eiaReading(snapshot: EiaApiSnapshot | null, now: number): Reading {
  const point = snapshot?.observations.filter(item => item.metric === 'demand' && !item.simulated && Date.parse(item.window.endAt) <= now)
    .toSorted((a, b) => a.window.endAt.localeCompare(b.window.endAt)).at(-1);
  return { value: point?.value == null ? 'Unavailable' : `${formatNumber(point.value)} ${point.unit}`, window: point?.window,
    available: point?.value != null, note: 'PACE regional demand · context only, never spare site capacity' };
}

function signalStatus(signal: Signal, now: number): { state: string; label: string } {
  const { feed, reading } = signal;
  if (!feed.snapshot || feed.status === 'unavailable') return { state: 'unavailable', label: 'Unavailable' };
  if (feed.status === 'stale') return { state: 'stale', label: 'Refresh failed' };
  const age = now - Date.parse(feed.snapshot.retrievedAt);
  if (!reading.available || !reading.window || !feed.revision || !Number.isFinite(age) || age < -60_000)
    return { state: 'unknown', label: 'Incomplete' };
  const intervalAge = now - Date.parse(reading.window.endAt);
  const delayed = signal.id === 'weather' ? age > 2 * hour || intervalAge >= 0
    : intervalAge > (signal.id === 'market' ? 15 * 60_000 : 2 * hour);
  if (!Number.isFinite(intervalAge)) return { state: 'unknown', label: 'Age unknown' };
  return delayed ? { state: 'stale', label: 'Delayed' } : { state: 'ready', label: signal.role };
}

function SourceIcon({ source }: { source: SourceId }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    {source === 'weather' ? <><circle cx="10" cy="10" r="3" /><path d="M10 1v3m0 12v3M1 10h3m12 0h3M3.6 3.6l2.1 2.1m8.6 8.6 2.1 2.1M3.6 16.4l2.1-2.1m8.6-8.6 2.1-2.1" /></>
      : source === 'market' ? <><path d="M3 3v14h14M5 13l4-5 3 2 5-6" /><path d="M13 4h4v4" /></>
        : <><path d="M2 16h16M5 16V9m5 7V4m5 12V7" /><circle cx="5" cy="7" r="1" /><circle cx="10" cy="2" r="1" /><circle cx="15" cy="5" r="1" /></>}
  </svg>;
}

function Publication({ title, snapshot, revision, reading, pinned }: {
  title: string; snapshot: Snapshot | null; revision: string | null; reading: Reading; pinned?: boolean;
}) {
  return <section className="source-signals-publication" data-pinned={pinned || undefined} aria-label={title}>
    <h4>{title}{pinned && <span>PINNED</span>}</h4>
    {reading.cities ? <div className="source-signals-cities">{reading.cities.map(city => <div key={city.name}><small>{city.name}</small><strong>{city.value}</strong></div>)}</div>
      : <strong className="source-signals-reading">{reading.value}</strong>}
    <p className="source-signals-note">{reading.note}</p>
    <dl className="source-signals-meta">
      <div><dt>Valid interval</dt><dd>{reading.window ? interval(reading.window) : 'Unavailable'}</dd></div>
      <div><dt>Retrieved</dt><dd>{snapshot ? <time dateTime={snapshot.retrievedAt} title={snapshot.retrievedAt}>{utc(snapshot.retrievedAt)}</time> : 'Unavailable'}</dd></div>
      <div><dt>Revision</dt><dd><code title={revision ?? undefined}>{revision ? revision.slice(0, 12) : 'Unavailable'}</code></dd></div>
    </dl>
  </section>;
}

function DetailedGridEvidence({ eia, market, now }: Pick<SourceSignalsProps, 'eia' | 'market' | 'now'>) {
  const [open, setOpen] = useState(false);
  return <details className="source-signals-grid-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Detailed grid evidence</summary>
    {open && <LiveGridReadings eia={eia} caiso={market} now={now} />}
  </details>;
}
/** Inspection only: subscriptions, refreshes and run capture belong to the caller. */
export function SourceSignals({ weather, market, eia, capture, now, onRefresh }: SourceSignalsProps) {
  const [selected, setSelected] = useState<SourceId | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState('');
  const id = useId();
  const buttons = useRef<Partial<Record<SourceId, HTMLButtonElement | null>>>({});
  const pinnedWeather = capture?.runInputs.weather;
  const pinnedMarket = capture?.runInputs.caiso;
  const signals: Signal[] = [
    { id: 'weather', name: 'Open-Meteo', role: 'Forecast', url: 'https://open-meteo.com/en/docs', feed: weather,
      reading: weatherReading(weather.snapshot, now),
      pinned: pinnedWeather && capture ? { ...pinnedWeather, reading: weatherReading(pinnedWeather.snapshot, Date.parse(capture.scenario.startAt)) } : undefined },
    { id: 'market', name: 'CAISO', role: 'Market', url: market.snapshot?.sourceUrl ?? pinnedMarket?.snapshot.sourceUrl ?? 'https://oasis.caiso.com', feed: market,
      reading: marketReading(market.snapshot, now),
      pinned: pinnedMarket && capture ? { ...pinnedMarket, reading: marketReading(pinnedMarket.snapshot, Date.parse(capture.capturedAt), capture.price) } : undefined },
    { id: 'eia', name: 'EIA', role: 'Observed', url: eia.snapshot?.sourceUrl ?? 'https://www.eia.gov/opendata/', feed: eia, reading: eiaReading(eia.snapshot, now) },
  ];
  const active = signals.find(signal => signal.id === selected);
  async function refresh() {
    setRefreshing(true); setRefreshResult('');
    try { await onRefresh(); setRefreshResult('Refresh finished. Source status shown above.'); }
    catch { setRefreshResult('Refresh failed. Retained readings remain visible.'); }
    finally { setRefreshing(false); }
  }
  function dismiss() {
    setSelected(null);
    if (selected) buttons.current[selected]?.focus();
  }
  return <div className="source-signals" onKeyDown={event => { if (event.key === 'Escape' && selected) { event.stopPropagation(); dismiss(); } }}>
    <div className="source-signals-strip" aria-label="Public data sources">
      {signals.map(signal => {
        const status = signalStatus(signal, now);
        return <button key={signal.id} ref={node => { buttons.current[signal.id] = node; }} type="button"
          className="source-signals-button" data-state={status.state} aria-label={`${signal.name} source`}
          aria-expanded={selected === signal.id} aria-controls={`${id}-details`} title={`${signal.reading.note} · ${receivedAge(signal.feed.snapshot?.retrievedAt, now)}`}
          onClick={() => setSelected(value => value === signal.id ? null : signal.id)}>
          <span className="source-signals-name"><SourceIcon source={signal.id} />{signal.name}<i aria-hidden="true" /></span>

          <span className="source-signals-status">{status.state === 'ready' ? signal.id === 'weather' ? 'Site weather' : signal.id === 'market' ? 'Reference price' : 'Grid context' : status.label}</span>
        </button>;
      })}
    </div>
    {active && <section id={`${id}-details`} className="source-signals-details" aria-label="Source details">
      <header><div><SourceIcon source={active.id} /><h3>{active.name}</h3><span className="source-signals-role">{active.role}</span></div>
        <button type="button" className="source-signals-close" aria-label="Close source details" onClick={dismiss}>×</button></header>
      <div className="source-signals-publications">
        {active.pinned && <Publication title="Used by this run" snapshot={active.pinned.snapshot} revision={active.pinned.revision} reading={active.pinned.reading} pinned />}
        <Publication title="Latest received" snapshot={active.feed.snapshot} revision={active.feed.revision} reading={active.reading} />
      </div>
      {active.pinned && <p className="source-signals-separation">{active.pinned.revision === active.feed.revision ? 'Latest revision matches this run.' : 'New readings do not change this run’s pinned inputs.'}</p>}
      {active.feed.error && <p className="source-signals-error">{active.feed.error}</p>}
      <footer><a href={active.url} aria-label={`${active.name} source`} target="_blank" rel="noreferrer" title={active.url}>{active.url}</a>
        <button type="button" aria-label="Refresh inputs" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh inputs'}</button></footer>
      {refreshResult && <p className="source-signals-note" role="status">{refreshResult}</p>}
      {active.id !== 'weather' && <DetailedGridEvidence key={active.id} eia={eia} market={market} now={now} />}
      {active.id === 'weather' && <WeatherHistory revision={weather.revision} />}
      <details className="source-signals-evidence"><summary>Full snapshot evidence</summary>
        <pre>{JSON.stringify({ role: active.role, sourceUrl: active.url,
          ...(active.pinned ? { usedByThisRun: { capturedAt: capture?.capturedAt, status: active.pinned.status, revision: active.pinned.revision, snapshot: active.pinned.snapshot } } : {}),
          latestReceived: active.feed }, null, 2)}</pre>
      </details>
    </section>}
  </div>;
}
