import type { CSSProperties } from 'react';
import type { SlotReference } from '../../core/energy/SlotReference.type';
import type { PriceHour, PriceStripProps, PriceDetailsProps, JobPriceChoiceProps, ForecastStripProps } from './PostedPrices.type';
import './PostedPrices.css';

const time = (value: string) => new Intl.DateTimeFormat('en', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
}).format(new Date(value));
const date = (value: string) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value));
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 });
const dollars = (value: number) => value > 0 && value < .000001 ? '<$0.000001' : value.toLocaleString('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
});
const sameSlot = (a: SlotReference | undefined, b: SlotReference) => a?.locationId === b.locationId && a.slotId === b.slotId;
const soldOut = (hour: PriceHour) => {
  const slot = hour.snapshot.slot;
  return !!slot && (slot.usedGpus >= slot.capGpus || slot.availableEnergyKWh === 0 || slot.availablePowerKW === 0);
};
function availability(hour: PriceHour) {
  if (hour.snapshot.status === 'unavailable' || !hour.snapshot.slot) return 'Unavailable';
  if (hour.snapshot.status === 'stale') return 'Stale reading';
  if (soldOut(hour)) return 'Sold out';
  return hour.snapshot.projected ? 'Conditional forecast' : 'Available now';
}
function Stamp({ value }: { value?: string }) {
  return value ? <time dateTime={value} title={value}>{new Date(value).toISOString().slice(0, 10)} · {time(value)} UTC</time> : <>Not supplied</>;
}

/** Inspection only. The caller owns routing, current evidence and the inspected reference. */
export function PriceStrip({ siteName, hours, selected, inspected, priceRange, onInspect }: PriceStripProps) {
  const rates = hours.filter(hour => hour.snapshot.status === 'current' && hour.snapshot.slot && !soldOut(hour))
    .map(hour => hour.snapshot.slot!.postedUsdPerGpuHour);
  const low = priceRange?.min ?? Math.min(...rates), high = priceRange?.max ?? Math.max(...rates);
  const current = hours.find(hour => availability(hour) === 'Available now');
  return <section className="posted-prices price-strip" aria-label={siteName + ' prices'}>
    <header><h3>{siteName}{hours.length > 0 && <span className="price-strip-date">{date(hours[0].window.startAt)}</span>}</h3><p>{current ? <><strong>{dollars(current.snapshot.slot!.postedUsdPerGpuHour)}</strong> <span>per GPU-hour</span></> : <span>No current offer</span>}</p></header>
    {hours.length ? <div className="price-strip-hours">{hours.map((hour, index) => {
      const status = availability(hour);
      const slot = hour.snapshot.status !== 'unavailable' ? hour.snapshot.slot : undefined;
      const chosen = status === 'Available now' && sameSlot(selected?.slot, hour.reference) && selected?.slotVersion === hour.snapshot.version;
      const ratio = slot && high > low ? Math.max(0, Math.min(1, (slot.postedUsdPerGpuHour - low) / (high - low))) : 0;
      const style = { '--price-color': `hsl(${132 - ratio * 100} 22% ${49 + ratio * 6}%)` } as CSSProperties;
      return <button key={hour.reference.slotId} type="button" className="price-hour" style={style}
        data-status={status} data-chosen={chosen} aria-pressed={sameSlot(inspected, hour.reference)}
        aria-label={`Inspect ${siteName}, ${time(hour.window.startAt)} UTC, ${slot ? dollars(slot.postedUsdPerGpuHour) + ' per GPU-hour, ' : ''}${status}${hour.snapshot.projected ? ', projected' : ''}, ${date(hour.window.startAt)}`}
        onClick={() => onInspect(hour)}>
        <span className="price-hour-band" aria-hidden="true" />
        <time dateTime={hour.window.startAt}>{time(hour.window.startAt)}</time>
        <small>{chosen ? <span className="price-selected">Selected</span> : status === 'Available now' ? 'Now' : status === 'Conditional forecast' ? 'Forecast' : status === 'Sold out' ? 'Sold out' : status === 'Stale reading' ? 'Stale' : 'Unavailable'}</small>
        {index > 0 && date(hour.window.startAt) !== date(hours[index - 1].window.startAt) && <span className="price-hour-date">{date(hour.window.startAt)}</span>}
      </button>;
    })}</div> : <p className="price-empty">No prices supplied.</p>}
  </section>;
}

export function PriceDetails({ siteName, hour }: PriceDetailsProps) {
  const slot = hour?.snapshot.status !== 'unavailable' ? hour?.snapshot.slot : undefined;
  return <section className="posted-prices price-details" aria-label="Price details">
    {hour ? <>
      <header><div><p className="price-eyebrow">INSPECTING</p><h3>{siteName} <span>· {date(hour.window.startAt)}<br />{time(hour.window.startAt)}–{date(hour.window.startAt) !== date(hour.window.endAt) ? date(hour.window.endAt) + ' ' : ''}{time(hour.window.endAt)} UTC</span></h3></div>
        <span className="price-status" data-status={availability(hour)}>{availability(hour)}</span></header>
      <p className="price-exact">{slot ? dollars(slot.postedUsdPerGpuHour) : 'Unavailable'}{slot && <small>USD / GPU-hour</small>}</p>
      {slot && <p className="price-capacity">{number(Math.max(0, slot.capGpus - slot.usedGpus))} GPUs unreserved <span>·</span> {number(slot.availableEnergyKWh)} kWh available</p>}
      {hour.snapshot.projected && <p className="price-condition">Projected capacity · not a reservation.</p>}
      {hour.snapshot.status === 'stale' && <p className="price-condition">Last supplied rate · not a current offer.</p>}
      <details className="price-disclosure"><summary>Price evidence</summary>
        <dl className="price-facts">
          {slot && <><div><dt>Power available</dt><dd>{number(slot.availablePowerKW)} kW</dd></div>
            <div><dt>Price model</dt><dd>{slot.priceBasis}</dd></div></>}
          {hour.breakdown ? <>
            <div><dt>Electricity / GPU-hour</dt><dd>{hour.breakdown.electricityUsdPerGpuHour === undefined ? 'Not supplied' : dollars(hour.breakdown.electricityUsdPerGpuHour)}</dd></div>
            <div><dt>Carbon / GPU-hour</dt><dd>{hour.breakdown.carbonUsdPerGpuHour === undefined ? 'Not supplied' : dollars(hour.breakdown.carbonUsdPerGpuHour)}</dd></div>
          </> : <div><dt>Price breakdown</dt><dd>Not supplied</dd></div>}
          <div><dt>Source</dt><dd>{hour.snapshot.source}</dd></div>
          <div><dt>Version</dt><dd>{hour.snapshot.version ?? 'Not supplied'}</dd></div>
          <div><dt>Observed</dt><dd><Stamp value={hour.snapshot.observedAt} /></dd></div>
          <div><dt>Reading</dt><dd>{hour.snapshot.simulated ? 'Simulated site inputs' : 'Supplied site inputs'}</dd></div>
        </dl>
        {(['carbon', 'demand', 'solar'] as const).map(metric => {
          const forecast = hour.forecast?.[metric];
          return forecast && <div className="price-forecast" key={metric}>
            <h4>{metric} forecast <span>{forecast.simulated ? 'Synthetic' : 'Supplied'}</span></h4>
            <dl className="price-facts">
              <div><dt>Source</dt><dd>{forecast.source}</dd></div>
              <div><dt>Scope / basis</dt><dd>{forecast.scope} · {forecast.basis}</dd></div>
              <div><dt>Issued</dt><dd><Stamp value={forecast.issuedAt} /></dd></div>
              <div><dt>Retrieved</dt><dd><Stamp value={forecast.retrievedAt} /></dd></div>
              {forecast.points.map((point, index) => <div key={index}><dt>Valid</dt><dd><Stamp value={point.window.startAt} /> – <Stamp value={point.window.endAt} /><br />
                {point.value === undefined ? 'Unavailable' : number(point.value) + ' ' + forecast.unit}</dd></div>)}
            </dl>
          </div>;
        })}
        {!hour.forecast || !Object.values(hour.forecast).some(Boolean) ? <p className="price-empty">No forecast supplied.</p> : null}
      </details>
    </> : <p className="price-empty">Choose an hour to inspect its price.</p>}
  </section>;
}

/** A recorded routing choice is displayed as supplied; no execution or history is produced here. */
export function JobPriceChoice({ jobName, outcome, siteNames, history = [], execution }: JobPriceChoiceProps) {
  const allocation = outcome?.selected ? outcome.allocation : undefined;
  const plannedKWh = allocation?.energy.length ? allocation.energy.reduce((total, period) => total + period.estimatedKWh, 0) : undefined;
  return <section className="posted-prices job-price-choice" aria-label="Job choice">
    <header><p className="price-eyebrow">THE JOB'S CHOICE</p><h3>{jobName}</h3></header>
    <span className="price-choice-state">{execution === 'modeled-complete' ? 'Modeled execution complete' : execution === 'modeled-running' ? 'Modeled execution running' : allocation ? 'Selected · not executed' : outcome ? 'No slot selected' : 'No decision yet'}</span>
    {allocation && <>
      <p className="price-destination"><span className="price-destination-dot" aria-hidden="true" />{siteNames[allocation.slot.locationId] ?? allocation.slot.locationId}</p>
      <p className="price-choice-rate">{dollars(allocation.postedUsdPerGpuHour)}<small>per GPU-hour</small></p>
      {allocation.energy.length === 1 && <p className="price-plan"><time dateTime={allocation.energy[0].window.startAt}>
        {time(allocation.energy[0].window.startAt)}–{time(allocation.energy[0].window.endAt)} UTC</time></p>}
      <p className="price-plan">{number(allocation.allocatedGpus)} {allocation.allocatedGpus === 1 ? 'GPU' : 'GPUs'}{plannedKWh !== undefined && <><span>·</span>{number(plannedKWh)} kWh estimated</>}</p>
      {plannedKWh === undefined && <p className="price-plan">Energy estimate not supplied</p>}
    </>}
    <div className="price-choice-reason"><p className="price-eyebrow">{allocation ? 'WHY THIS WINDOW' : 'WHY'}</p><p>{outcome?.explanation ?? 'Waiting for a supplied routing decision.'}</p></div>
    <details className="price-disclosure"><summary>Decision history</summary>
      {history.length ? <ol className="price-history">{history.map((decision, index) => <li key={index}>
        <time dateTime={decision.at}>{time(decision.at)} UTC</time><p>{decision.reason}</p>
      </li>)}</ol> : <p className="price-empty">No decisions supplied yet.</p>}
    </details>
  </section>;
}

/** Display supplied hourly forecast points; gaps remain gaps and each source keeps its own timestamps. */
export function ForecastStrip({ siteName, hours, onInspect }: ForecastStripProps) {
  const metrics = (['carbon', 'demand', 'solar'] as const).filter(metric => hours.some(hour => hour.forecast?.[metric]));
  const synthetic = hours.some(hour => Object.values(hour.forecast ?? {}).some(forecast => forecast?.simulated));
  return <section className="posted-prices site-forecast" aria-label={siteName + ' forecast'}>
    <header><h3>{siteName} forecast{hours.length > 0 && <span className="forecast-date">{date(hours[0].window.startAt)}</span>}</h3>{metrics.length > 0 && <span>{synthetic ? 'Includes synthetic inputs' : 'Supplied forecast'}</span>}</header>
    {metrics.length ? <>
      {metrics.map(metric => {
        const units = [...new Set(hours.flatMap(hour => hour.forecast?.[metric]?.unit ?? []))];
        return <div className="forecast-metric" key={metric}>
          <p>{metric[0].toUpperCase() + metric.slice(1)}{units.length === 1 ? ' · ' + units[0] : ' forecast'}</p>
          <div className="forecast-hours">{hours.map((hour, index) => {
            const forecast = hour.forecast?.[metric];
            const start = Date.parse(hour.window.startAt), end = Date.parse(hour.window.endAt);
            const point = forecast?.points.find(point => Date.parse(point.window.startAt) === start && Date.parse(point.window.endAt) === end);
            return <button type="button" key={hour.reference.slotId} onClick={() => onInspect(hour)}
              aria-label={`Inspect ${siteName} ${metric} forecast, ${time(hour.window.startAt)} UTC, ${date(hour.window.startAt)}`}
              title={date(hour.window.startAt) + ' · ' + (point ? number(point.value) + ' ' + forecast!.unit : 'Unavailable')}>
              <time dateTime={hour.window.startAt}>{time(hour.window.startAt)}</time>
              <strong>{point ? number(point.value) : '—'}</strong><small>{point ? units.length > 1 ? forecast!.unit : 'Forecast' : 'Unavailable'}</small>
              {index > 0 && date(hour.window.startAt) !== date(hours[index - 1].window.startAt) && <small>{date(hour.window.startAt)}</small>}
            </button>;
          })}</div>
        </div>;
      })}
      <details className="price-disclosure"><summary>Forecast sources</summary>
        {hours.map(hour => metrics.map(metric => {
          const forecast = hour.forecast?.[metric];
          return forecast && <div className="price-forecast" key={hour.reference.slotId + metric}>
            <h4>{metric} · {date(hour.window.startAt)} {time(hour.window.startAt)} UTC</h4>
            <dl className="price-facts"><div><dt>Source</dt><dd>{forecast.source}</dd></div>
              <div><dt>Scope / basis</dt><dd>{forecast.scope} · {forecast.basis}</dd></div>
              <div><dt>Evidence</dt><dd>{forecast.simulated ? 'Synthetic forecast' : 'Supplied forecast'}</dd></div>
              <div><dt>Issued</dt><dd><Stamp value={forecast.issuedAt} /></dd></div>
              <div><dt>Retrieved</dt><dd><Stamp value={forecast.retrievedAt} /></dd></div></dl>
          </div>;
        }))}
      </details>
    </> : <p className="price-empty">No forecast supplied.</p>}
  </section>;
}
