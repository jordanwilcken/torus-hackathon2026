import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './FleetMap.css';
import { dataCenters, originForJob } from '../../data/dataCenters';
import { createFleetActivity } from './fleetActivity';
import type { TransferObservation } from '../../core/execution/TransferObservation.type';
import type { FleetCapacity } from './fleetCapacity';

export type FleetSiteVisual = FleetCapacity & {
  id: string; name: string; latitude: number; longitude: number;
  capacity: number; solarKW: number; storedKWh: number; storageCapacityKWh: number;
  activeJobs: number; queuedJobs: number;
};
type Props = {
  activityEpoch?: number; sites: FleetSiteVisual[]; transfers: readonly TransferObservation[]; playing: boolean; completed?: boolean;
  admissions?: Array<{ jobId: string; homeLocation: string }>; onOrigin?: (id: string) => void;
  selected?: string; selectedJob?: string; onInspect: (id: string) => void; onJob: (id: string) => void;
};
const color = (site: FleetSiteVisual, completed: boolean) => completed ? '#7c929c' : site.capacityState === 'unknown' ? '#89969a'
  : site.capacityState === 'allocated' ? '#7298b5' : site.capacityState === 'constrained' ? '#d16f63'
  : site.availableGpus! < site.capacity / 2 ? '#d7af5e' : '#53ad83';

const glyphPaths = {
  packet: 'M6 3h8l4 4v14H6Z M14 3v4h4 M10 10l-2 3 2 3 M14 10l2 3-2 3',
  compute: 'M6 6h12v12H6Z M10 10h4v4h-4Z M9 3v3 M15 3v3 M9 18v3 M15 18v3 M3 9h3 M3 15h3 M18 9h3 M18 15h3',
};
type GlyphKind = keyof typeof glyphPaths;
function MapGlyph({ kind }: { kind: GlyphKind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={glyphPaths[kind]} /></svg>;
}
function createMapGlyph(kind: GlyphKind) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', glyphPaths[kind]);
  svg.append(path);
  return svg;
}

export function FleetMapKey() {
  return <div className="fleet-map-key" role="group" aria-label="Modeled job flow">
      <div className="fleet-map-key-flow">
        <span><i className="fleet-map-key-origin" aria-hidden="true"><MapGlyph kind="packet" /></i>Simulated jobs</span>
        <b aria-hidden="true">→</b>
        <span><i className="fleet-map-key-compute" aria-hidden="true"><MapGlyph kind="compute" /></i>Modeled compute</span>

      </div>
    </div>;
}

/** One persistent geographic view. Camera changes never step or reconstruct the model. */
export function FleetMap({ sites, transfers, playing, completed = false, selected, selectedJob, onInspect, onJob, admissions = [], onOrigin, activityEpoch = 0 }: Props) {
  const [routeHistory, setRouteHistory] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const seen = useRef(new Set<string>());
  const activity = useRef<ReturnType<typeof createFleetActivity> | null>(null);
  const callbacks = useRef({ onInspect, onJob, onOrigin });
  callbacks.current = { onInspect, onJob, onOrigin };
  useEffect(() => {
    // Mount and Reset show existing history quietly. Only later additions announce activity.
    seen.current = new Set([...transfers.map(item => item.id), ...admissions.map(item => `admission:${item.jobId}`)]);
    activity.current?.clear();
  }, [activityEpoch]);
  useEffect(() => {
    const element = container.current!;
    const view = L.map(element, { zoomControl: false, scrollWheelZoom: true, zoomAnimation: false, zoomSnap: .25 });
    map.current = view;
    activity.current = createFleetActivity(view);
    const initialBounds = L.latLngBounds([[25, -125], [49, -67]]);
    const padding = L.point(40, 55);
    // Layers need a finite camera even when the CPU pane initially hides this map.
    view.setView(initialBounds.getCenter(), 3);
    L.control.zoom({ position: 'bottomleft' }).addTo(view);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(view);
    let inspection: L.Tooltip | undefined;
    const closeInspection = () => {
      if (!inspection) return;
      const previous = inspection; inspection = undefined;
      view.closeTooltip(previous);
      previous.getElement()?.remove();
    };
    const showInspection = (event: L.TooltipEvent) => {
      if (!event.tooltip.options.className?.split(' ').includes('fleet-tooltip')) return;
      if (inspection !== event.tooltip) closeInspection();
      inspection = event.tooltip;
    };
    view.on('tooltipopen', showInspection);
    view.on('movestart zoomstart', closeInspection);
    let initiallyFitted = false;
    let disposed = false;
    const resize = new ResizeObserver(() => {
      if (disposed) return;
      // A zero-size container minus padding produces an invalid bounds-fit scale.
      if (element.clientWidth <= padding.x * 2 || element.clientHeight <= padding.y * 2) return;
      view.invalidateSize({ pan: false });
      if (!initiallyFitted) {
        view.fitBounds(initialBounds, { padding, animate: false });
        initiallyFitted = true;
      }
    });
    resize.observe(element);
    return () => { disposed = true; resize.disconnect(); view.off('tooltipopen', showInspection); view.off('movestart zoomstart', closeInspection); closeInspection(); activity.current?.clear(); view.remove(); map.current = null; activity.current = null; };
  }, []);
  useEffect(() => {
    const layer = L.layerGroup().addTo(map.current!);
    for (const site of sites) {
      if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
      const element = document.createElement('button');
      element.className = 'fleet-node';
      element.style.setProperty('--site-color', color(site, completed));
      element.dataset.siteId = site.id;
      element.dataset.capacityState = site.capacityState;
      element.dataset.physicalGpus = String(site.availableGpus ?? 'unknown');
      element.dataset.state = completed ? 'complete' : site.capacityState === 'unknown' ? 'unknown' : site.activeJobs ? 'working' : site.capacityState;
      element.setAttribute('aria-label', `Inspect ${site.name}`);
      element.setAttribute('aria-pressed', String(selected === site.id));
      element.innerHTML = '<span class="fleet-node-halo"></span><span class="fleet-node-body"><span class="fleet-node-glyph"></span></span><span class="fleet-node-orbit"></span><span class="fleet-node-name"></span>';
      element.querySelector('.fleet-node-glyph')!.append(createMapGlyph('compute'));
      element.querySelector('.fleet-node-name')!.textContent = site.name;
      element.addEventListener('click', event => { event.stopPropagation(); callbacks.current.onInspect(site.id); });
      const marker = L.marker([site.latitude, site.longitude], { keyboard: false,
        icon: L.divIcon({ html: element, className: 'fleet-marker', iconSize: [50, 50], iconAnchor: [25, 25] }) }).addTo(layer);
      const tooltip = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = site.name; tooltip.append(name);
      const purpose = document.createElement('div'); purpose.textContent = 'Modeled compute site · solar, grid and battery'; tooltip.append(purpose);
      const line = document.createElement('div'); line.textContent = completed ? 'Model complete · inspect results' : site.capacityState === 'unknown' ? 'GPU capacity unknown · missing model inputs'
        : `Up to ${site.availableGpus} / ${site.capacity} modeled GPUs available · ${site.scheduledGpus} scheduled`;
      tooltip.append(line);
      if (!completed && site.remainingEnergyKWh !== null) {
        const budget = document.createElement('div');
        budget.textContent = `${site.remainingEnergyKWh.toFixed(2)} kWh modeled budget left · runtime may be less than an hour`;
        tooltip.append(budget);
      }
      const power = document.createElement('small'); power.textContent = completed ? 'Final modeled storage: ' + site.storedKWh.toFixed(2) + ' kWh' : site.capacityState === 'unknown' ? 'Capacity needs current model inputs'
        : `${site.solarKW.toFixed(2)} kW modeled solar · ${site.storedKWh.toFixed(2)} kWh stored`;
      tooltip.append(power);
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -22], className: 'fleet-tooltip', interactive: false });
      element.addEventListener('focus', () => marker.openTooltip());
      element.addEventListener('blur', () => marker.closeTooltip());
    }
    return () => { layer.remove(); };
  }, [sites, selected, completed]);
  useEffect(() => {
    const view = map.current!;
    const layer = L.layerGroup().addTo(view);
    for (const [index, transfer] of transfers.entries()) {
      const from = sites.find(site => site.id === transfer.fromLocation), to = sites.find(site => site.id === transfer.toLocation);
      if (!from || !to) continue;
      const points: L.LatLngTuple[] = Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        return [from.latitude + (to.latitude - from.latitude) * t + Math.sin(t * Math.PI) * Math.abs(to.longitude - from.longitude) * .14,
          from.longitude + (to.longitude - from.longitude) * t];
      });
      // Static route density never limits the real event announcements below.
      if (transfer.jobId === selectedJob || index >= transfers.length - (routeHistory ? 10 : 1)) {
        const line = L.polyline(points, { color: '#0d9488', weight: 2, opacity: .42, className: 'fleet-route' }).addTo(layer);
        const path = line.getElement();
        path?.setAttribute('data-job-id', transfer.jobId);
        path?.setAttribute('data-transfer-id', transfer.id);
        path?.setAttribute('role', 'button');
        path?.setAttribute('tabindex', '0');
        path?.setAttribute('aria-label', `Inspect transfer ${transfer.jobId} from ${from.name} to ${to.name}`);
        line.bindTooltip(`${transfer.jobId} · ${from.name} → ${to.name} · Site move · modeled transfer`, { className: 'fleet-tooltip', interactive: false });
        line.on('click', () => callbacks.current.onJob(transfer.jobId));
        path?.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') callbacks.current.onJob(transfer.jobId); });
      }
      if (!seen.current.has(transfer.id)) {
        seen.current.add(transfer.id);
        activity.current?.show({ id: transfer.id, jobId: transfer.jobId, kind: 'transfer', route: points,
          from: { name: from.name, point: [from.latitude, from.longitude] },
          to: { name: to.name, point: [to.latitude, to.longitude] } });
      }
    }
    return () => { layer.remove(); };
  }, [transfers, activityEpoch, routeHistory, selectedJob]);
  useEffect(() => {
    const view = map.current!;
    const layer = L.layerGroup().addTo(view);
    for (const source of dataCenters) {
      const element = document.createElement('button');
      element.className = 'fleet-datacenter';
      element.setAttribute('aria-label', `Inspect data center ${source.name}`);
      element.innerHTML = '<span class="fleet-origin-body" aria-hidden="true"></span>';
      element.querySelector('.fleet-origin-body')!.append(createMapGlyph('packet'));
      element.addEventListener('click', () => callbacks.current.onOrigin?.(source.id));
      const marker = L.marker([source.latitude, source.longitude], { keyboard: false,
        icon: L.divIcon({ html: element, className: 'fleet-marker', iconSize: [30, 30], iconAnchor: [-23, 15] }) }).addTo(layer);
      const tooltip = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = source.name;
      const purpose = document.createElement('div'); purpose.textContent = 'Synthetic jobs · public location reference';
      const count = document.createElement('small'); count.textContent = admissions.filter(job => originForJob(job.jobId).id === source.id).length + ' simulated submissions · no operator workload feed';
      const citation = document.createElement('small'); citation.textContent = 'Location source: ' + new URL(source.sourceUrl).hostname; citation.title = source.sourceUrl;
      tooltip.append(title, purpose, count, citation);
      marker.bindTooltip(tooltip, { direction: 'top', className: 'fleet-tooltip', interactive: false });
      element.addEventListener('focus', () => marker.openTooltip());
      element.addEventListener('blur', () => marker.closeTooltip());
    }
    for (const [index, admission] of admissions.entries()) {
      const source = originForJob(admission.jobId), destination = sites.find(site => site.id === admission.homeLocation);
      if (!destination) continue;
      const points: L.LatLngTuple[] = Array.from({ length: 25 }, (_, index) => {
        const t = index / 24;
        return [source.latitude + (destination.latitude - source.latitude) * t + Math.sin(t * Math.PI) * Math.abs(destination.longitude - source.longitude) * .08,
          source.longitude + (destination.longitude - source.longitude) * t];
      });
      const identity = `admission:${admission.jobId}`;
      if (admission.jobId === selectedJob || index >= admissions.length - (routeHistory ? 6 : 2)) {
        const line = L.polyline(points, { color: '#2563eb', weight: 1.5, opacity: .3, dashArray: '3 6', className: 'fleet-admission' }).addTo(layer);
        line.getElement()?.setAttribute('data-job-id', admission.jobId);
        line.getElement()?.setAttribute('data-event-id', identity);
        line.bindTooltip(`${admission.jobId} · New job · simulated submission from ${source.name} to assigned home queue ${destination.name}`, { className: 'fleet-tooltip', interactive: false });
        line.on('click', () => callbacks.current.onJob(admission.jobId));
      }
      if (!seen.current.has(identity)) {
        seen.current.add(identity);
        activity.current?.show({ id: identity, jobId: admission.jobId, kind: 'submission', route: points,
          from: { name: source.name, point: [source.latitude, source.longitude] },
          to: { name: destination.name, point: [destination.latitude, destination.longitude] } });
      }
    }
    return () => { layer.remove(); };
  }, [admissions, activityEpoch, routeHistory, selectedJob]);
  function zoom(utah: boolean) {
    map.current?.fitBounds(utah ? [[36.8, -114.4], [41.6, -110.5]] : [[25, -125], [49, -67]], { padding: [40, 55], animate: false });
  }
  return <div className="fleet-geography compact-energy-map" data-playing={playing}>
    <div className="fleet-canvas" ref={container} role="region" aria-label="Continuous fleet map" />
    <div className="fleet-camera"><button onClick={() => zoom(false)}>Show US</button><button onClick={() => zoom(true)}>Explore Utah</button>
      <button className="fleet-route-history" aria-label="Show route history" aria-pressed={routeHistory} onClick={() => setRouteHistory(value => !value)}>Routes</button></div>
    <div className="fleet-legend"><FleetMapKey /><strong className="fleet-legend-title">Energy-supported GPU capacity · modeled</strong>
      {completed ? <span><i style={{ background: '#7c929c' }} />Model complete · inspect results</span> : <>
        <span><i style={{ background: '#53ad83' }} />Open</span><span><i style={{ background: '#d7af5e' }} />Limited</span>
        <span><i style={{ background: '#7298b5' }} />Allocated</span><span><i style={{ background: '#d16f63' }} />Energy constrained</span><span><i style={{ background: '#89969a' }} />Unknown</span>
      </>}
      <small>Capacity, not carbon ranking</small>
      <small className="fleet-activity-key"><span><i style={{ background: '#2563eb' }} />Submission to home queue</span><span><i style={{ background: '#0d9488' }} />Chosen site move</span></small>
    </div>
  </div>;
}
