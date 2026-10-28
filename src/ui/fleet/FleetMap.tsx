import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { dataCenters, originForJob } from '../../data/dataCenters';
import { showMapActivity } from '../energy/mapActivity';
import type { TransferObservation } from '../../core/execution/TransferObservation.type';

export type FleetSiteVisual = {
  id: string; name: string; latitude: number; longitude: number;
  availableGpus: number; capacity: number; solarKW: number; storedKWh: number; storageCapacityKWh: number;
  activeJobs: number; queuedJobs: number; unknown?: boolean;
};
type Props = {
  activityEpoch?: number; sites: FleetSiteVisual[]; transfers: readonly TransferObservation[]; playing: boolean;
  admissions?: Array<{ jobId: string; homeLocation: string }>; onOrigin?: (id: string) => void;
  selected?: string; onInspect: (id: string) => void; onJob: (id: string) => void;
};
const color = (site: FleetSiteVisual) => site.unknown ? '#89969a' : site.availableGpus <= 0 ? '#d16f63'
  : site.availableGpus < site.capacity / 2 ? '#d7af5e' : '#53ad83';

/** One persistent geographic view. Camera changes never step or reconstruct the model. */
export function FleetMap({ sites, transfers, playing, selected, onInspect, onJob, admissions = [], onOrigin, activityEpoch = 0 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const seen = useRef(new Set<string>());
  const callbacks = useRef({ onInspect, onJob, onOrigin });
  callbacks.current = { onInspect, onJob, onOrigin };
  useEffect(() => { seen.current.clear(); }, [activityEpoch]);
  useEffect(() => {
    const view = L.map(container.current!, { zoomControl: false, scrollWheelZoom: true, zoomAnimation: false, zoomSnap: .25 });
    map.current = view;
    view.fitBounds([[25, -125], [49, -67]], { padding: [40, 55], animate: false });
    L.control.zoom({ position: 'bottomleft' }).addTo(view);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(view);
    const resize = new ResizeObserver(() => view.invalidateSize({ pan: false }));
    resize.observe(container.current!);
    return () => { resize.disconnect(); view.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const layer = L.layerGroup().addTo(map.current!);
    for (const site of sites) {
      if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
      const element = document.createElement('button');
      element.className = 'fleet-node';
      element.style.setProperty('--site-color', color(site));
      element.dataset.siteId = site.id;
      element.dataset.state = site.unknown ? 'unknown' : site.activeJobs ? 'working' : site.availableGpus > 0 ? 'available' : 'constrained';
      element.setAttribute('aria-label', `Inspect ${site.name}`);
      element.setAttribute('aria-pressed', String(selected === site.id));
      element.innerHTML = '<span class="fleet-node-halo"></span><span class="fleet-node-body"><span class="fleet-node-glyph">▦</span></span><span class="fleet-node-orbit"></span><span class="fleet-node-name"></span>';
      element.querySelector('.fleet-node-name')!.textContent = site.name;
      element.addEventListener('click', event => { event.stopPropagation(); callbacks.current.onInspect(site.id); });
      const marker = L.marker([site.latitude, site.longitude], { keyboard: false,
        icon: L.divIcon({ html: element, className: 'fleet-marker', iconSize: [50, 50], iconAnchor: [25, 25] }) }).addTo(layer);
      const tooltip = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = site.name; tooltip.append(name);
      const line = document.createElement('div'); line.textContent = site.unknown ? 'Source unavailable · no modeled activity'
        : `${site.availableGpus} / ${site.capacity} modeled GPUs available for a full hour · ${site.activeJobs} working`;
      tooltip.append(line);
      const power = document.createElement('small'); power.textContent = site.unknown ? 'Connect public inputs to start'
        : `${site.solarKW.toFixed(2)} kW modeled solar · ${site.storedKWh.toFixed(2)} kWh stored`;
      tooltip.append(power);
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -22], className: 'fleet-tooltip' });
      element.addEventListener('focus', () => marker.openTooltip());
      element.addEventListener('blur', () => marker.closeTooltip());
    }
    return () => { layer.remove(); };
  }, [sites, selected]);
  useEffect(() => {
    const view = map.current!;
    const layer = L.layerGroup().addTo(view);
    for (const transfer of transfers.slice(-10)) {
      const from = sites.find(site => site.id === transfer.fromLocation), to = sites.find(site => site.id === transfer.toLocation);
      if (!from || !to) continue;
      const points: L.LatLngTuple[] = Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        return [from.latitude + (to.latitude - from.latitude) * t + Math.sin(t * Math.PI) * Math.abs(to.longitude - from.longitude) * .14,
          from.longitude + (to.longitude - from.longitude) * t];
      });
      const line = L.polyline(points, { color: '#3d9d83', weight: 2, opacity: .42, className: 'fleet-route' }).addTo(layer);
      const path = line.getElement();
      path?.setAttribute('data-job-id', transfer.jobId);
      path?.setAttribute('data-transfer-id', transfer.id);
      path?.setAttribute('role', 'button');
      path?.setAttribute('tabindex', '0');
      path?.setAttribute('aria-label', `Inspect transfer ${transfer.jobId} from ${from.name} to ${to.name}`);
      line.bindTooltip(`${transfer.jobId} · ${from.name} → ${to.name} · modeled transfer`);
      line.on('click', () => callbacks.current.onJob(transfer.jobId));
      path?.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') callbacks.current.onJob(transfer.jobId); });
      if (!seen.current.has(transfer.id)) { seen.current.add(transfer.id); showMapActivity(view, points); }
    }
    return () => { layer.remove(); };
  }, [transfers, activityEpoch]);
  useEffect(() => {
    const view = map.current!;
    const layer = L.layerGroup().addTo(view);
    for (const source of dataCenters) {
      const element = document.createElement('button');
      element.className = 'fleet-datacenter';
      element.setAttribute('aria-label', `Inspect data center ${source.name}`);
      element.innerHTML = '<span aria-hidden="true">▤</span><small>DC</small>';
      element.addEventListener('click', () => callbacks.current.onOrigin?.(source.id));
      const marker = L.marker([source.latitude, source.longitude], { keyboard: false,
        icon: L.divIcon({ html: element, className: 'fleet-marker', iconSize: [30, 30], iconAnchor: [-23, 15] }) }).addTo(layer);
      const tooltip = document.createElement('div');
      tooltip.textContent = `${source.name} · ${admissions.filter(job => originForJob(job.jobId).id === source.id).length} simulated submissions · city reference`;
      marker.bindTooltip(tooltip, { direction: 'top', className: 'fleet-tooltip' });
      element.addEventListener('focus', () => marker.openTooltip());
      element.addEventListener('blur', () => marker.closeTooltip());
    }
    for (const admission of admissions.slice(-6)) {
      const source = originForJob(admission.jobId), destination = sites.find(site => site.id === admission.homeLocation);
      if (!destination) continue;
      const points: L.LatLngTuple[] = Array.from({ length: 25 }, (_, index) => {
        const t = index / 24;
        return [source.latitude + (destination.latitude - source.latitude) * t + Math.sin(t * Math.PI) * Math.abs(destination.longitude - source.longitude) * .08,
          source.longitude + (destination.longitude - source.longitude) * t];
      });
      const identity = `admission:${admission.jobId}`;
      const line = L.polyline(points, { color: '#6e9cbb', weight: 1.5, opacity: .3, dashArray: '3 6', className: 'fleet-admission' }).addTo(layer);
      line.getElement()?.setAttribute('data-job-id', admission.jobId);
      line.getElement()?.setAttribute('data-event-id', identity);
      line.bindTooltip(`${admission.jobId} · simulated submission from ${source.name}`);
      line.on('click', () => callbacks.current.onJob(admission.jobId));
      if (!seen.current.has(identity)) { seen.current.add(identity); showMapActivity(view, points, '#80b5d3'); }
    }
    return () => { layer.remove(); };
  }, [admissions, activityEpoch]);
  function zoom(utah: boolean) {
    map.current?.fitBounds(utah ? [[36.8, -114.4], [41.6, -110.5]] : [[25, -125], [49, -67]], { padding: [40, 55], animate: false });
  }
  return <div className="fleet-geography compact-energy-map" data-playing={playing}>
    <div className="fleet-canvas" ref={container} role="region" aria-label="Continuous fleet map" />
    <div className="fleet-camera"><button onClick={() => zoom(false)}>Show US</button><button onClick={() => zoom(true)}>Explore Utah</button></div>
    <div className="fleet-legend"><span><i style={{ background: '#53ad83' }} />Available</span><span><i style={{ background: '#d7af5e' }} />Limited</span><span><i style={{ background: '#d16f63' }} />No full-hour slot</span><small>▤ Data center job sources · orbit = working<br />Modeled full-hour capacity & synthetic submissions</small></div>
  </div>;
}
