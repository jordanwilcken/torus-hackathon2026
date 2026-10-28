import { useEffect, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { getEnergyMap } from '../../core/energy/getEnergyMap';
import type { SlotReference } from '../../core/energy/SlotReference.type';
import type { Job } from '../../core/jobs/Job.type';
import type { JobOutcome } from '../../core/scheduling/JobOutcome.type';
import regions from './regions.json';

const chipIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>';

type JobPlacement = {
  job: Job;
  outcome?: JobOutcome;
  routeAttempt: number;
};

type MapInspection = {
  inspectedSlot?: SlotReference;
  focusSlot?: SlotReference;
  onInspect: (slot: SlotReference) => void;
  onPreview: (slot: SlotReference) => void;
  onRegion: (regionId: string) => void;
  onDismiss: () => void;
};

type EnergyBasemapProps = {
  sites: ReturnType<typeof getEnergyMap>['sites'];
  placement: JobPlacement;
  inspection: MapInspection;
  detailCard: {
    content?: ReactNode;
    location?: { latitude?: number; longitude?: number };
  };
  children?: ReactNode;
};

export function EnergyBasemap({ sites, placement, inspection, detailCard, children }: EnergyBasemapProps) {
  const { job, outcome, routeAttempt } = placement;
  const { inspectedSlot, focusSlot, onInspect, onPreview, onRegion, onDismiss } = inspection;
  const { content: details, location: detailLocation } = detailCard;
  const container = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const focusedMarker = useRef<string | null>(null);
  const restoringFocus = useRef(false);
  const detailTrigger = useRef<string | null>(null);
  const animatedAttempt = useRef(0);
  const selectedSlot = outcome?.selected ? outcome.allocation.slot : undefined;
  const origin = sites.get(job.currentLocation);
  const destination = selectedSlot && sites.get(selectedSlot.locationId);
  const originLocated = Number.isFinite(origin?.latitude) && Number.isFinite(origin?.longitude);
  const [localView, setLocalView] = useState(false);
  const [tileError, setTileError] = useState(false);

  function closeDetails() {
    if (card.current?.contains(document.activeElement)) {
      const trigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
        .find(button => button.getAttribute('aria-label') === detailTrigger.current);
      restoringFocus.current = true;
      trigger?.focus({ preventScroll: true });
      restoringFocus.current = false;
    }
    onDismiss();
  }

  useEffect(() => {
    const view = L.map(container.current!, { zoomSnap: .25, scrollWheelZoom: false, zoomAnimation: false });
    map.current = view;
    view.fitBounds([[25, -126], [49.5, -66]], { padding: [35, 35], animate: false });
    view.on('zoomend', () => setLocalView(view.getZoom() >= 7));
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).addTo(view);
    const resize = new ResizeObserver(() => view.invalidateSize({ pan: false }));
    resize.observe(container.current!);
    return () => { resize.disconnect(); view.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!focusSlot) return;
    const site = sites.get(focusSlot.locationId);
    if (Number.isFinite(site?.latitude) && Number.isFinite(site?.longitude))
      map.current?.setView([site!.latitude!, site!.longitude!], 8, { animate: false });
  }, [focusSlot]);

  useEffect(() => {
    if (!originLocated) return;
    const view = map.current!;
    const layer = L.layerGroup().addTo(view);
    const renderer = L.svg().addTo(view);
    const start: L.LatLngTuple = [origin!.latitude!, origin!.longitude!];
    const staying = selectedSlot?.locationId === job.currentLocation;
    const animate = outcome?.selected && routeAttempt !== animatedAttempt.current;
    if (outcome) animatedAttempt.current = routeAttempt;
    const source = L.circleMarker(start, { renderer, radius: staying ? 22 : 10,
      color: staying ? '#15986c' : '#42667c', weight: 2, fillOpacity: .08,
      className: staying ? 'job-stay' + (animate ? ' placement-confirm' : '') : 'job-origin',
    }).addTo(layer);
    source.getElement()!.setAttribute('data-origin-location-id', job.currentLocation);
    if (staying) {
      source.getElement()!.setAttribute('data-placement', 'stay');
      source.getElement()!.setAttribute('data-location-id', selectedSlot!.locationId);
    }
    const drawing = source.getElement()!.closest('svg')!;
    drawing.setAttribute('role', 'img');
    drawing.setAttribute('aria-label', 'Job placement: ' + job.id + (staying
      ? ' stays at ' + (origin?.name ?? job.currentLocation) + '; execution not started'
      : outcome?.selected ? ' assigned from ' + (origin?.name ?? job.currentLocation) + ' to '
        + (destination?.name ?? selectedSlot!.locationId) + '; execution not started'
        : outcome ? ' has no selected site' : ' waiting at ' + (origin?.name ?? job.currentLocation)));

    if (destination && !staying && Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
      const end: L.LatLngTuple = [destination.latitude!, destination.longitude!];
      const points: L.LatLngTuple[] = Array.from({ length: 33 }, (_, step) => {
        const t = step / 32, bend = Math.sin(Math.PI * t) * .12;
        return [start[0] + (end[0] - start[0]) * t + Math.abs(end[1] - start[1]) * bend,
          start[1] + (end[1] - start[1]) * t - Math.abs(end[0] - start[0]) * bend];
      });
      const line = L.polyline(points, { renderer, interactive: false, color: '#15986c', weight: 2.2,
        opacity: .85, className: 'job-route' + (animate ? ' route-reveal' : ''),
      }).addTo(layer);
      for (const [name, value] of Object.entries({ 'data-selected': 'true',
        'data-origin-location-id': job.currentLocation, 'data-location-id': selectedSlot!.locationId, pathLength: '1' }))
        line.getElement()!.setAttribute(name, value);
    }
    return () => { layer.remove(); renderer.remove(); };
  }, [job.id, job.currentLocation, outcome?.selected, routeAttempt, selectedSlot?.locationId,
    origin?.latitude, origin?.longitude, origin?.name, destination?.latitude, destination?.longitude, destination?.name]);

  useEffect(() => {
    if (!details || !card.current) return;
    const view = map.current!;
    if (document.activeElement?.tagName === 'BUTTON' && document.activeElement.hasAttribute('aria-label') && !card.current.contains(document.activeElement))
      detailTrigger.current = document.activeElement.getAttribute('aria-label');
    function positionCard() {
      const size = view.getSize(), element = card.current!;
      const point = Number.isFinite(detailLocation?.latitude) && Number.isFinite(detailLocation?.longitude)
        ? view.latLngToContainerPoint([detailLocation!.latitude!, detailLocation!.longitude!]) : L.point(12, 90);
      element.style.left = Math.max(12, Math.min(point.x + 95, size.x - element.offsetWidth - 12)) + 'px';
      element.style.top = Math.max(76, Math.min(point.y - 35, size.y - element.offsetHeight - 20)) + 'px';
    }
    positionCard();
    view.on('move zoom resize', positionCard);
    const resize = new ResizeObserver(positionCard);
    resize.observe(card.current);
    return () => { view.off('move zoom resize', positionCard); resize.disconnect(); };
  }, [details, detailLocation]);

  useEffect(() => {
    if (outcome) container.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [job.id, outcome?.selected]);

  useEffect(() => {
    const markers = L.layerGroup().addTo(map.current!);
    function pin(latitude: number, longitude: number, label: string, title: string, subtitle: string,
      className: string, preview: () => void, action = preview, reference?: SlotReference) {
      const button = document.createElement('button');
      const isOrigin = reference?.locationId === job.currentLocation;
      const selected = reference?.locationId === selectedSlot?.locationId && reference !== undefined;
      const viewing = reference?.locationId === inspectedSlot?.locationId && reference !== undefined;
      button.type = 'button'; button.className = 'map-pin ' + className;
      button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(viewing));
      button.dataset.selected = String(selected); button.dataset.origin = String(isOrigin);
      if (reference) button.dataset.locationId = reference.locationId;
      const name = document.createElement('strong'); name.textContent = title;
      const detail = document.createElement('span'); detail.textContent = subtitle;
      button.append(name, detail);
      if (isOrigin || selected) {
        const token = document.createElement('span');
        token.className = 'job-assignment' + (selected ? '' : ' at-origin');
        token.setAttribute('role', 'img');
        token.setAttribute('aria-label', (selected ? 'Assigned job ' : 'Job request ') + job.id);
        token.innerHTML = chipIcon;
        const caption = document.createElement('small');
        caption.textContent = (selected ? isOrigin ? 'Stays here' : 'Selected for this job' : 'Source') + ' · ' + job.id;
        button.append(token, caption);
      }
      if (viewing) { const badge = document.createElement('small'); badge.textContent = 'Viewing'; button.append(badge); }
      const showPreview = () => { detailTrigger.current = label; preview(); };
      button.onmousemove = showPreview;
      button.onfocus = () => { if (!restoringFocus.current) showPreview(); };
      button.onclick = () => { detailTrigger.current = label; action(); };
      L.DomEvent.disableClickPropagation(button);
      L.marker([latitude, longitude], { icon: L.divIcon({ html: button, className: 'map-pin-anchor', iconSize: [0, 0] }),
        keyboard: false, zIndexOffset: viewing || selected ? 500 : 0,
      }).addTo(markers);
    }
    for (const region of regions) pin(region.latitude, region.longitude, 'Inspect ' + region.id + ' region',
      region.id, region.city, 'region-pin', () => onRegion(region.id));
    for (const site of sites.values()) {
      if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
      if (!localView && site.id !== job.currentLocation && site.id !== selectedSlot?.locationId) continue;
      const reading = site.slots.find(item => item.reference.slotId === inspectedSlot?.slotId) ?? site.slots[0];
      pin(site.latitude!, site.longitude!, 'Inspect ' + (site.name ?? site.id), site.name ?? site.id,
        reading.snapshot.status + ' evidence · ' + (reading.snapshot.simulated ? 'Fake data' : 'source data'),
        'site-pin', () => onPreview(reading.reference), () => onInspect(reading.reference), reading.reference);
    }
    const focusedButton = [...container.current!.querySelectorAll<HTMLButtonElement>('.map-pin')]
      .find(button => button.getAttribute('aria-label') === focusedMarker.current);
    restoringFocus.current = true;
    focusedButton?.focus({ preventScroll: true });
    restoringFocus.current = false; focusedMarker.current = null;
    return () => {
      const active = document.activeElement;
      focusedMarker.current = active?.classList.contains('map-pin') && container.current?.contains(active)
        ? active.getAttribute('aria-label') : null;
      restoringFocus.current = true;
      markers.remove();
    };
  }, [sites, job, inspectedSlot, selectedSlot, localView, onInspect, onPreview, onRegion]);

  return <div className="basemap" role="region" aria-label="US energy map"
    onPointerLeave={event => { if (!event.currentTarget.contains(document.activeElement)) onDismiss(); }}
    onBlur={event => { if (!restoringFocus.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) onDismiss(); }}
    onKeyDown={event => { if (event.key === 'Escape') closeDetails(); }}>
    <div className="map-toolbar"><div className="map-switch">
      <button type="button" aria-pressed={!localView} onClick={() => {
        map.current?.fitBounds([[25, -126], [49.5, -66]], { padding: [35, 35], animate: false }); onDismiss();
      }}>Show US</button>
      <button type="button" aria-pressed={localView} onClick={() => {
        map.current?.setView([40.5, -111.8], 8, { animate: false }); onDismiss();
      }}>Explore Utah</button>
    </div><span>Real geography · supplied site data</span></div>
    <div ref={container} className="map-canvas" onClick={event => {
      if (!(event.target as Element).closest('.map-pin, .leaflet-control')) onDismiss();
    }} />
    {details && <div ref={card} className="map-hover-card">
      <button className="close-details" aria-label="Close details" onClick={closeDetails}>×</button>{details}
    </div>}
    {children}
    {!originLocated && <p className="map-error">Job origin coordinates are unavailable.</p>}
    {tileError && <p className="map-error">Map tiles could not load. Site data and inspection are still available below.</p>}
  </div>;
}
