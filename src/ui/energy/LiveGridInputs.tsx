import { useEffect, useMemo, useState } from 'react';
import { ApiRegionalGrid } from '../../core/energy/data/ApiRegionalGrid';
import type { EiaApiSnapshot } from '../../core/energy/data/eiaApi';
import type { GridContext } from '../../core/energy/GridContext.type';
import type { TimeWindow } from '../../core/TimeWindow.type';
import type { BrowserFeed } from '../../data/createFeedClient';
import type { PublicGridClient } from '../../data/createPublicGridClient';
import { useFeed } from '../data/useFeed';

import './LiveGridInputs.css';


const minute = 60_000;
const mw = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function interval(window: TimeWindow): string {
  const start = window.startAt.slice(0, 16).replace('T', ' ');
  const end = window.endAt.slice(0, 10) === window.startAt.slice(0, 10)
    ? window.endAt.slice(11, 16) : window.endAt.slice(0, 16).replace('T', ' ');
  return `${start}–${end} UTC`;
}

function ageLabel(endAt: string, now: number, delayedAfter: number): string {
  const elapsed = now - Date.parse(endAt);
  if (elapsed < 0) return 'Active interval';
  const minutes = Math.floor(elapsed / minute);
  const hours = Math.floor(minutes / 60);
  const age = hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  return `${elapsed > delayedAfter ? 'Delayed · ' : ''}${age} old`;
}

function FeedStatus<T>({ feed }: { feed: BrowserFeed<T> }) {
  const label = feed.loading ? 'Connecting…' : feed.status === 'ready' ? 'Request succeeded'
    : feed.snapshot ? 'Refresh failed · showing last successful data' : 'Unavailable';
  return <>
    <p className="live-feed-status" data-status={feed.loading ? 'loading' : feed.status} role="status">{label}</p>
    {feed.error && <p className="live-feed-error">{feed.error}</p>}
  </>;
}

function Provenance({ snapshot, label }: { snapshot: { source: string; sourceUrl: string; retrievedAt: string } | null; label: string }) {
  if (!snapshot) return null;
  return <footer className="live-grid-provenance">
    <p>Retrieved <time dateTime={snapshot.retrievedAt}>{snapshot.retrievedAt.slice(0, 19).replace('T', ' ')} UTC</time></p>
    <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer" title={snapshot.source}>{label}</a>
  </footer>;
}

function regionalContext(snapshot: EiaApiSnapshot | null): GridContext {
  if (!snapshot) return { observations: [], forecast: {} };
  const forecastPeriods = snapshot.forecast.demand?.points.map(point => point.window) ?? [];
  const periods = [...snapshot.observations.map(observation => observation.window), ...forecastPeriods];
  if (!periods.length) return { observations: [], forecast: {} };
  const startAt = periods.reduce((first, period) => period.startAt < first ? period.startAt : first, periods[0].startAt);
  const endAt = periods.reduce((last, period) => period.endAt > last ? period.endAt : last, periods[0].endAt);
  return new ApiRegionalGrid(snapshot).read('PACE', { startAt, endAt });
}

export function LiveGridInputs({ feeds }: { feeds: PublicGridClient }) {
  const eia = useFeed(feeds.eia);
  const caiso = useFeed(feeds.caiso);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const context = useMemo(() => regionalContext(eia.snapshot), [eia.snapshot]);
  const actuals = ([['demand', 'Regional demand'], ['generation', 'Net generation'], ['interchange', 'Net interchange']] as const).map(([metric, label]) => ({
    label, observation: context.observations.filter(observation => observation.metric === metric && Date.parse(observation.window.endAt) <= now)
      .sort((a, b) => a.window.endAt.localeCompare(b.window.endAt)).at(-1),
  }));
  const demand = context.forecast.demand;
  const forecast = demand?.points.toSorted((a, b) => a.window.endAt.localeCompare(b.window.endAt)).at(-1);
  // OASIS can publish the next dispatch interval before it starts. Keep it out of the latest started price.
  const price = caiso.snapshot?.prices.filter(point => Date.parse(point.window.startAt) <= now)
    .sort((a, b) => a.window.startAt.localeCompare(b.window.startAt)).at(-1);

  return <section className="live-grid-inputs" aria-label="Live regional inputs">
    <header className="live-grid-heading">
      <div><p className="eyebrow">CONNECTED PUBLIC FEEDS</p><h2>Regional grid inputs</h2></div>
      <p>PacifiCorp East · Utah regional context</p>
    </header>
    <div className="live-grid-cards">
      <section className="live-grid-card" aria-label="EIA regional observations">
        <header><h3>EIA-930 · reported actuals</h3><FeedStatus feed={eia} /></header>
        <div className="table-scroll"><table aria-label="Latest reported regional observations">
          <thead><tr><th scope="col">Measure</th><th scope="col">Hourly average</th><th scope="col">Reported interval</th><th scope="col">Data age</th></tr></thead>
          <tbody>{actuals.map(({ label, observation }) => <tr key={label}>
            <th scope="row">{label}</th><td className="live-grid-number">{observation?.value == null ? 'Unavailable' : `${mw.format(observation.value)} MW`}</td>
            <td>{observation ? interval(observation.window) : 'No reported interval'}</td>
            <td>{observation ? ageLabel(observation.window.endAt, now, 120 * minute) : 'Unknown'}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="live-grid-note">Reported hourly energy expressed as average MW. Positive interchange is net export. Data age runs from the interval end.</p>
        <section className="live-grid-forecast" aria-label="Day-ahead demand forecast">
          <div><h4>Day-ahead demand forecast</h4><p>Latest supplied interval · forecast, not an actual reading</p></div>
          <strong>{forecast ? `${mw.format(forecast.value)} MW` : 'Unavailable'}</strong>
          <p>{forecast ? interval(forecast.window) : 'No forecast interval supplied'}</p>
          <p>Issued time: {demand?.issuedAt ?? 'Unavailable'}</p>
        </section>
        <p className="live-grid-unknown">Carbon intensity unavailable in this API connection</p>
        <Provenance snapshot={eia.snapshot} label="EIA-930 source" />
      </section>
      <section className="live-grid-card live-price-card" aria-label="CAISO wholesale prices">
        <header><h3>CAISO OASIS · five-minute price</h3><FeedStatus feed={caiso} /></header>
        <p className="live-grid-node">ELAP_PACE-APND</p>
        <p className="live-grid-price">{price ? <>{usd.format(price.usdPerMWh)} <span>/ MWh</span></> : 'Unavailable'}</p>
        <p className="live-grid-price-label">Provisional wholesale price</p>
        <p className="live-grid-price-period">{price ? interval(price.window) : 'No started price interval available'}</p>
        {price && <p className="live-grid-price-age">{ageLabel(price.window.endAt, now, 15 * minute)}</p>}
        <p className="live-grid-note">Latest supplied interval that has started. The market may publish a forthcoming dispatch interval before it begins.</p>
        <p className="live-grid-unknown">Retail bill unavailable · this feed does not include a site tariff or retail charges.</p>
        <Provenance snapshot={caiso.snapshot} label="CAISO OASIS source" />
      </section>
    </div>
    <p className="live-grid-scope">Regional context only. Site power limits, storage, compute capacity and permission to use energy require local evidence.</p>
  </section>;
}
