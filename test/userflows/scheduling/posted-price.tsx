import { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { EnergyMap } from '../../../src/core/energy/EnergyMap.interface';
import { getEnergyMap } from '../../../src/core/energy/getEnergyMap';
import type { SlotReference } from '../../../src/core/energy/SlotReference.type';
import type { Job } from '../../../src/core/jobs/Job.type';
import { EnergyBasemap } from '../../../src/ui/energy/EnergyBasemap';
import { ForecastStrip, JobPriceChoice, PriceDetails, PriceStrip } from '../../../src/ui/scheduling/PostedPrices';
import type { PriceHour } from '../../../src/ui/scheduling/PostedPrices.type';
import { at, history, scenario, siteNames, type Scene } from './price-preview-data';
import '../../../src/style.css';
import './posted-price.css';

const locations = {
  lehi: { name: 'Lehi', latitude: 40.3916, longitude: -111.8508, regionId: 'PACE' },
  provo: { name: 'Provo', latitude: 40.2338, longitude: -111.6585, regionId: 'PACE' },
};
const job: Job = {
  id: 'training-batch', workloadRef: 'Training batch', computeProfile: 'illustrative-gpu',
  window: { startAt: at, endAt: '2026-10-28T13:00:00Z' }, readyAt: at,
  allowedLocations: ['lehi', 'provo'], homeLocation: 'provo', currentLocation: 'provo',
  workGpuH: .25, remainingGpuH: .25, maxGpus: 1, dataGB: 0, state: 'queued',
};
const sameSlot = (a: SlotReference, b: SlotReference) => a.locationId === b.locationId && a.slotId === b.slotId;
const ignoreHover = () => {};

/** The map and price pieces read the same supplied examples; this is not the live application composition. */
function project(data: ReturnType<typeof scenario>) {
  const hours = data.sites.flatMap(site => site.hours);
  const lookup = (reference: SlotReference) => hours.find(hour => sameSlot(hour.reference, reference));
  const source: EnergyMap = {
    findSlots: () => hours.map(hour => hour.reference),
    readSlot: reference => {
      const hour = lookup(reference);
      return hour ? { ...hour.snapshot, location: locations[reference.locationId as keyof typeof locations] }
        : { status: 'unavailable', source: 'not-supplied', projected: false, simulated: true };
    },
    readForecast: reference => lookup(reference)?.forecast ?? {},
  };
  return getEnergyMap({ asOf: at, window: { startAt: at, endAt: '2026-10-29T16:00:00Z' } }, source);
}

let show = (_scene: Scene) => {};
let read = () => scenario('selected');
Object.assign(window, { pricePreview: { show: (scene: Scene) => show(scene), read: () => structuredClone(read()) } });

function Preview() {
  const [scene, setScene] = useState<Scene>('selected');
  const [activity, setActivity] = useState(1);
  const [data, setData] = useState(() => scenario('selected'));
  const [inspected, setInspected] = useState<PriceHour>();
  const [forecastLocation, setForecastLocation] = useState(data.sites[0].id);
  const [region, setRegion] = useState<string>();
  const [focus, setFocus] = useState<SlotReference | undefined>(() => data.sites[0].hours[0]?.reference);
  const projection = useMemo(() => project(data), [data]);
  const activeJob = useMemo(() => data.outcome?.selected ? { ...job, id: data.outcome.allocation.jobId } : job, [data.outcome]);
  const dismiss = useCallback(() => { setInspected(undefined); setRegion(undefined); }, []);
  const inspectHour = useCallback((hour: PriceHour) => {
    setInspected(hour); setForecastLocation(hour.reference.locationId); setRegion(undefined); setFocus(hour.reference);
  }, []);
  const inspectReference = useCallback((reference: SlotReference) => {
    const hour = data.sites.flatMap(site => site.hours).find(hour => sameSlot(hour.reference, reference));
    if (hour) inspectHour(hour);
  }, [data, inspectHour]);
  const inspectRegion = useCallback((id: string) => { setRegion(id); setForecastLocation(id); setInspected(undefined); }, []);
  show = next => {
    const nextData = scenario(next);
    setScene(next); setData(nextData); setForecastLocation(nextData.sites[0].id); setFocus(nextData.sites[0].hours[0]?.reference); dismiss();
  };
  read = () => data;
  const location = inspected && locations[inspected.reference.locationId as keyof typeof locations];
  const forecastSite = data.sites.find(site => site.id === forecastLocation);

  return <main className="price-map-preview">
    <header className="price-map-heading"><div><a href="#" aria-label="Sunchaser">sunchaser<span aria-hidden="true">✳</span></a><p>Utah compute · shared PACE grid context</p></div>
      <div><p>Simulated preview · selection only</p><time dateTime={at}>28 Oct 2026 · 12:00 UTC</time></div></header>
    <div className="price-map-layout">
      <section className="price-map-shell" aria-label="Compute locations">
        <EnergyBasemap appearance="compact" sites={projection.sites} placement={{ job: activeJob, outcome: data.outcome, routeAttempt: activity }}
          inspection={{ inspectedSlot: inspected?.reference, focusSlot: focus,
            onInspect: inspectReference, onPreview: ignoreHover, onRegion: inspectRegion, onDismiss: dismiss }}
          detailCard={{ location, content: inspected
            ? <PriceDetails siteName={siteNames[inspected.reference.locationId as keyof typeof siteNames]} hour={inspected} />
            : region ? <section className="price-region-context" aria-label="Regional context"><h3>{region}</h3>
              <p>Regional grid signals are shared. Site capacity and compute prices are modeled separately.</p>
              <small>No live regional reading is connected to this preview.</small></section> : undefined }}>
          <button className="map-replay" type="button" disabled={!data.outcome?.selected}
            title="Replay a supplied selection; this does not start execution" onClick={() => setActivity(value => value + 1)}>Replay sample route</button>
        </EnergyBasemap>
      </section>
      <aside className="price-map-job"><JobPriceChoice jobName={job.workloadRef} outcome={data.outcome} siteNames={siteNames} history={scene === 'empty' ? [] : history} />
        <p className="price-map-execution">Execution not started · job energy not measured.</p></aside>
      <section className="price-map-timeline" aria-label="Upcoming prices">
        <header><div><h2>Prices ahead</h2><p>Inspect an hour without leaving the map.</p></div><span>UTC · USD / GPU-hour</span></header>
        <div className="price-map-strips">{data.sites.map(site => <PriceStrip key={site.id} siteName={site.name} hours={site.hours}
          selected={data.outcome?.selected ? data.outcome.allocation : undefined} inspected={inspected?.reference}
          priceRange={{ min: .045, max: .11 }} onInspect={inspectHour} />)}</div>
        <p className="price-map-legend"><span><i />Lower price</span><span><i />Higher price</span><span><i />Sold out</span></p>
      </section>
      <div className="price-map-forecast"><ForecastStrip siteName={forecastSite?.name ?? forecastLocation}
        hours={forecastSite?.hours ?? []} onInspect={inspectHour} /></div>
    </div>
    <footer className="price-map-footer"><details><summary>How this fits the live demo</summary>
      <p>Public input revision → modeled site offer → job choice → actual local job and output.</p>
      <p>This view explains the choice in place. Live input wiring and actual worker output remain on their own tasks. Missing readings stay unavailable; measured job energy stays unknown until supplied.</p></details>
      <nav aria-label="Preview states">{(['selected', 'waiting', 'stale', 'unknown', 'revised', 'empty'] as const).map(state =>
        <button key={state} type="button" aria-pressed={scene === state} onClick={() => show(state)}>{state === 'unknown' ? 'Unavailable' : state}</button>)}</nav>
    </footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
