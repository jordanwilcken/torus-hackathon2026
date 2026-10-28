import { useCallback, useEffect, useId, useState } from 'react';
import type { getEnergyMap } from '../../core/energy/getEnergyMap';
import type { SlotReference } from '../../core/energy/SlotReference.type';
import type { Job } from '../../core/jobs/Job.type';
import type { JobReport } from '../../core/reporting/JobReport.type';
import { carbonReductionKg, modeledCostReductionUsd } from '../../core/reporting/impact/compareImpact';
import { EnergyBasemap } from './EnergyBasemap';
import regions from './regions.json';

const time = (value: string) => value.slice(11, 16);
const amount = (value: number | undefined, unit: string) =>
  value === undefined ? 'Unavailable' : value.toFixed(2) + unit;
const change = (reduction: number | undefined, unit: string) => reduction === undefined ? '—'
  : (reduction > 0 ? '−' : reduction < 0 ? '+' : '') + Math.abs(reduction).toFixed(2) + ' ' + unit;
const direction = (reduction: number | undefined) => reduction === undefined ? 'unknown'
  : reduction > 0 ? 'lower' : reduction < 0 ? 'higher' : 'same';

type EnergyMapViewProps = {
  map: ReturnType<typeof getEnergyMap>;
  jobFlow: {
    job: Job;
    report: JobReport;
    routeAttempt: number;
  };
  inspection: {
    inspectedSlot?: SlotReference;
    focusSlot?: SlotReference;
    onInspect: (slot: SlotReference) => void;
  };
};

export function EnergyMapView({ map, jobFlow, inspection }: EnergyMapViewProps) {
  const { job, report, routeAttempt } = jobFlow;
  const { inspectedSlot, focusSlot, onInspect } = inspection;
  const id = useId();
  const outcome = report.routingOutcome;
  const allocation = outcome?.selected ? outcome.allocation : undefined;
  const plannedEnergy = allocation?.energy.length
    ? allocation.energy.reduce((total, interval) => total + interval.estimatedKWh, 0) : undefined;
  const carbonReduction = carbonReductionKg(report.carbon);
  const costReduction = modeledCostReductionUsd(report.cost);
  const selectedSlot = allocation?.slot;
  const [preview, setPreview] = useState<{ slot?: SlotReference; regionId?: string }>();
  const dismiss = useCallback(() => setPreview(undefined), []);
  useEffect(dismiss, [job.id, outcome?.selected, allocation?.slot.locationId, allocation?.slot.slotId, dismiss]);
  const previewSite = useCallback((slot: SlotReference) => setPreview(previous =>
    previous?.slot?.locationId === slot.locationId && previous.slot.slotId === slot.slotId ? previous : { slot }), []);
  const previewRegion = useCallback((regionId: string) => setPreview(previous =>
    previous?.regionId === regionId ? previous : { regionId }), []);
  const inspect = useCallback((reference: SlotReference) => {
    previewSite(reference); onInspect(reference);
  }, [onInspect, previewSite]);
  const region = regions.find(item => item.id === preview?.regionId);
  const sites = [...map.sites.values()];
  const activeReference = preview?.slot ?? inspectedSlot;
  const activeSite = sites.find(site => site.id === activeReference?.locationId) ?? sites[0];
  const activeReading = activeSite?.slots.find(reading => reading.reference.slotId === activeReference?.slotId)
    ?? activeSite?.slots[0];
  const slot = activeReading?.snapshot.slot;
  const selected = selectedSlot?.locationId === activeSite?.id && selectedSlot?.slotId === activeReading?.reference.slotId;
  const start = Date.parse(map.window.startAt);
  const duration = Date.parse(map.window.endAt) - start;
  const position = (timestamp: string) => Math.max(0, Math.min(100, (Date.parse(timestamp) - start) / duration * 100));

  const details = preview && (region ? <section aria-label="Regional overview">
    <strong>{region.city}</strong><span className="pill">{region.id}</span>
    <p>Energy data not connected.</p><p className="muted">City reference location.</p>
  </section> : <section aria-label="Site details" className="energy-site-details">
    <strong>{activeSite?.name ?? activeSite?.id}</strong>
    <p className="evidence-state">{activeSite?.regionId} · {activeReading?.snapshot.status} evidence · {activeReading?.snapshot.simulated ? 'Fake data' : 'source data'}
      {activeReading?.snapshot.projected && ' · projected'}</p>
    {selected && <p className="selection-badge">{job.currentLocation === selectedSlot?.locationId ? 'Stays here' : 'Selected for this job'}</p>}
    <dl className="energy-site-metrics">
      <div><dt>Posted / GPU-hour</dt><dd>{slot ? '$' + slot.postedUsdPerGpuHour.toFixed(2) : 'Unavailable'}</dd></div>
      <div><dt>Available energy</dt><dd>{amount(slot?.availableEnergyKWh, ' kWh')}</dd></div>
      <div><dt>Power limit</dt><dd>{amount(slot?.availablePowerKW, ' kW')}</dd></div>
      <div><dt>GPU cap / reserved</dt><dd>{slot ? slot.capGpus + ' / ' + slot.usedGpus : 'Unavailable'}</dd></div>
    </dl>
    <details className="source-details"><summary>Data source</summary>
      <p>Snapshot: {activeReading?.snapshot.source ?? 'Unavailable'}</p>
      <p>Observed: {activeReading?.snapshot.observedAt ?? 'Unavailable'}</p>
    </details>
  </section>);

  return <section className="energy-view" aria-label="Energy sites">
    <header className="energy-heading">
      <div><p className="eyebrow">THE NETWORK</p><h2>Energy across the US</h2></div>
      <p>{regions.length} regional locations <span>+</span> Utah local energy</p>
    </header>
    <div className="energy-map-layout">
      <EnergyBasemap sites={map.sites}
        placement={{ job, outcome, routeAttempt }}
        inspection={{ inspectedSlot: activeReading?.reference, focusSlot, onInspect: inspect,
          onPreview: previewSite, onRegion: previewRegion, onDismiss: dismiss }}
        detailCard={{ content: details, location: region ?? activeSite }}>
        {allocation && <div className="impact-readout" role="region" aria-label="Job impact">
          <p>{report.jobId}</p>
          <dl>
            <div title="Energy estimated for the selected allocation."><dt>Planned energy</dt><dd>{plannedEnergy === undefined ? '—' : '~' + plannedEnergy.toFixed(2) + ' kWh'}</dd></div>
            <div data-direction={direction(carbonReduction)} title={report.carbon.unavailableReason ?? 'Change versus baseline; negative means lower carbon emissions.'}>
              <dt>Carbon change</dt><dd>{change(carbonReduction, 'kg')}</dd></div>
            <div data-direction={direction(costReduction)} title={report.cost.unavailableReason ?? 'Change versus baseline under the report’s modeled cost policy; negative means lower cost.'}>
              <dt>Modeled cost change</dt><dd>{change(costReduction, 'USD')}</dd></div>
          </dl>
        </div>}
      </EnergyBasemap>
    </div>
    <div className="site-picker" aria-label="Utah site list">
      <span className="eyebrow">UTAH SITES</span>
      {sites.map(site => {
        const located = Number.isFinite(site.latitude) && Number.isFinite(site.longitude);
        return <button key={site.id} className="site-choice" aria-pressed={!region && activeSite?.id === site.id}
          aria-label={(located ? 'View ' : 'Inspect ') + (site.name ?? site.id)} onClick={() => inspect(site.slots[0].reference)}>
          <span>{site.name ?? site.id}</span><small>{located ? site.slots[0].snapshot.status + ' evidence' : 'coordinates unavailable'}</small>
        </button>;
      })}
    </div>
    {activeSite && !region && <section className="energy-timeline" aria-labelledby={id + '-timeline'}>
      <div className="timeline-heading"><h3 id={id + '-timeline'}>Energy timeline</h3><p>{activeSite.name ?? activeSite.id} · supplied availability</p></div>
      <div className="energy-time-axis"><span>{map.window.startAt.slice(0, 10)} · {time(map.window.startAt)} UTC</span><span>{time(map.window.endAt)} UTC</span></div>
      {activeSite.slots.map(reading => {
        const interval = reading.snapshot.slot?.window;
        const label = interval ? time(interval.startAt) + '–' + time(interval.endAt) + ' UTC' : 'Time unavailable';
        const left = interval ? position(interval.startAt) : 0;
        const width = interval ? position(interval.endAt) - left : 100;
        return <div className="energy-time-track" key={reading.reference.slotId}>
          <button className="energy-time-slot" style={{ marginLeft: left + '%', width: width + '%' }}
            aria-label={label + ', ' + reading.snapshot.status + ' evidence'}
            aria-pressed={activeReading?.reference.slotId === reading.reference.slotId}
            data-evidence={reading.snapshot.status} onClick={() => inspect(reading.reference)}>
            <span>{label}</span><strong>{amount(reading.snapshot.slot?.availableEnergyKWh, ' kWh')}</strong>
            <small>{reading.snapshot.status}{reading.snapshot.projected ? ' · projected' : ''}</small>
          </button>
        </div>;
      })}
    </section>}
  </section>;
}
