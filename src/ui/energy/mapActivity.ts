import L from 'leaflet';

/** A supplied activity gets one transient visual trail; this does not represent completed work. */
export function showMapActivity(view: L.Map, points: L.LatLngTuple[], color = '#63bc98',
  motion: { durationMs?: number; tailLength?: number } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const durationMs = motion.durationMs ?? 1_450;
  const tailLength = motion.tailLength ?? .18;
  const trailScale = tailLength / .18;
  const layer = L.layerGroup().addTo(view);
  const renderer = L.svg().addTo(view);
  let closed = false;
  let timeout: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    view.off('unload', cleanup);
    layer.remove(); renderer.remove();
  };
  timeout = setTimeout(cleanup, durationMs + (motion.durationMs === undefined ? 550 : 100));
  view.once('unload', cleanup);
  for (const part of [
    { name: 'tail', length: tailLength, width: 5, strength: .22 },
    { name: 'core', length: .065 * trailScale, width: 2.5, strength: .65 },
    { name: 'head', length: .006 * trailScale, width: 3, strength: 1 },
  ]) {
    const line = L.polyline(points, { renderer, interactive: false, color, weight: part.width,
      lineCap: 'round', className: 'map-comet map-comet-' + part.name }).addTo(layer);
    const path = line.getElement() as SVGPathElement;
    path.setAttribute('pathLength', '1');
    path.setAttribute('aria-hidden', 'true');
    path.closest('svg')?.setAttribute('aria-hidden', 'true');
    path.style.setProperty('--trail-start', String(part.length));
    path.style.setProperty('--trail-end', String(part.length - 1 - tailLength));
    path.style.animationDuration = durationMs + 'ms';
    if (motion.durationMs !== undefined) path.style.animationTimingFunction = 'linear';
    path.style.setProperty('--trail-strength', String(part.strength));
    if (part.name === 'head') {
      path.addEventListener('animationend', cleanup, { once: true });
      path.addEventListener('animationcancel', cleanup, { once: true });
    }
  }
  return cleanup;
}
