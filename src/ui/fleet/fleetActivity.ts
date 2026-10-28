import L from 'leaflet';
import { showMapActivity } from '../energy/mapActivity';

type Endpoint = { name: string; point: L.LatLngTuple };
type FleetEvent = {
  id: string;
  jobId: string;
  kind: 'submission' | 'transfer';
  from: Endpoint;
  to: Endpoint;
  route: L.LatLngTuple[];
};

/** Keep transient tags inside the map and clear of other current event labels. */
function placeLabel(view: L.Map, tooltip: L.Tooltip, label: HTMLElement, occupied: DOMRect[]) {
  const bounds = view.getContainer().getBoundingClientRect();
  for (let row = 0; row < 4; row++) for (const direction of ['top', 'bottom'] as const) {
    const vertical = (30 + row * (label.offsetHeight + 8)) * (direction === 'top' ? -1 : 1);
    tooltip.options.direction = direction;
    tooltip.options.offset = [0, vertical];
    tooltip.update();
    const initial = label.getBoundingClientRect();
    const horizontal = Math.max(0, bounds.left + 8 - initial.left) - Math.max(0, initial.right - bounds.right + 8);
    tooltip.options.offset = [horizontal, vertical];
    tooltip.update();
    const candidate = label.getBoundingClientRect();
    if (candidate.top < bounds.top + 8 || candidate.bottom > bounds.bottom - 8) continue;
    if (occupied.every(other => candidate.right + 4 <= other.left || candidate.left >= other.right + 4
      || candidate.bottom + 4 <= other.top || candidate.top >= other.bottom + 4)) return;
  }
  // Dense activity retains its geographic anchor; the underlying map remains inspectable.
  tooltip.options.direction = 'top';
  tooltip.options.offset = [0, -30];
  tooltip.update();
}

/** Owns transient presentation only; supplied events remain the source of every displayed fact. */
export function createFleetActivity(view: L.Map) {
  const active = new Map<string, { tooltip: L.Tooltip; label: HTMLElement; close: () => void }>();

  function arrange() {
    const occupied: DOMRect[] = [];
    for (const feedback of active.values()) {
      placeLabel(view, feedback.tooltip, feedback.label, occupied);
      occupied.push(feedback.label.getBoundingClientRect());
    }
  }

  function clear() {
    for (const feedback of [...active.values()]) feedback.close();
  }
  view.on('zoomend moveend resize', arrange);
  view.once('unload', () => { clear(); view.off('zoomend moveend resize', arrange); });

  function show(event: FleetEvent) {
    active.get(event.id)?.close();
    const color = event.kind === 'submission' ? '#2563eb' : '#0d9488';
    const layer = L.layerGroup().addTo(view);
    const endTrail = showMapActivity(view, event.route, color);
    for (const [endpoint, value] of [['source', event.from], ['destination', event.to]] as const) {
      const pulse = L.circleMarker(value.point, {
        interactive: false, radius: 13, color, weight: 1.5, fillColor: color, fillOpacity: .08,
        className: 'fleet-event-pulse',
      }).addTo(layer).getElement()!;
      pulse.setAttribute('data-event-id', event.id);
      pulse.setAttribute('data-endpoint', endpoint);
      pulse.setAttribute('aria-hidden', 'true');
    }

    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = event.jobId;
    const route = document.createElement('span'); route.textContent = `From ${event.from.name} → ${event.to.name}`;
    const kind = document.createElement('small');
    kind.textContent = event.kind === 'submission' ? 'New job · Simulated submission to home queue' : 'Site move · Modeled transfer';
    content.append(title, route, kind);
    const tooltip = L.tooltip({
      permanent: true, interactive: false, opacity: 1, direction: 'top',
      offset: [0, -30], className: 'fleet-event-tag',
    }).setLatLng(event.to.point).setContent(content).addTo(layer);
    const label = tooltip.getElement()!;
    label.dataset.eventId = event.id;
    label.dataset.jobId = event.jobId;
    label.dataset.kind = event.kind;

    // Readability is wall-clock presentation time, independent of simulation speed.
    const timer = setTimeout(close, 4_000);
    function close() {
      clearTimeout(timer);
      endTrail();
      layer.remove();
      // Leaflet normally retains a fading tooltip for another 200ms; Reset owns immediate cleanup.
      label.remove();
      active.delete(event.id);
    }
    active.set(event.id, { tooltip, label, close });
    arrange();
  }

  return { show, clear };
}
