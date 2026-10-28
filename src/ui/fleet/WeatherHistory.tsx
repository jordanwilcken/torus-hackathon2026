import { useEffect, useId, useState } from 'react';
import './WeatherHistory.css';

type Site = { locationId: string; latitude: number; longitude: number };
type Revision = {
  revision: string; retrievedAt: string; source: 'Open-Meteo'; sourceKind: 'forecast';
  model: 'best_match'; issuedAt: null; sites: Site[]; forecastDays: number | null;
};
type Comparison = {
  basis: 'forecast-revision-change'; unit: 'W/m²'; temporalBasis: 'preceding-hour-average';
  earlier: { revision: string; retrievedAt: string }; later: { revision: string; retrievedAt: string };
  site: Site; commonWindow: { startAt: string; endAt: string } | null;
  points: Array<{ window: { startAt: string; endAt: string }; earlier: number | null; later: number | null; change: number | null }>;
  note: string;
};
const utc = (value: string) => value.slice(0, 16).replace('T', ' ') + ' UTC';
const number = (value: number | null) => value === null ? 'Missing' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const captureLabel = (value: Revision) => `${utc(value.retrievedAt)} · ${value.revision.slice(0, 8)}`;

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Saved forecast evidence is unavailable. Close and reopen to retry.');
  return response.json() as Promise<T>;
}

function RevisionChart({ comparison }: { comparison: Comparison }) {
  const title = useId();
  const points = comparison.points;
  if (!points.length) return null;
  const start = Date.parse(points[0].window.endAt);
  const duration = Math.max(3_600_000, Date.parse(points.at(-1)!.window.endAt) - start);
  const maximum = Math.max(1, ...points.flatMap(point => [point.earlier ?? 0, point.later ?? 0]));
  const x = (point: Comparison['points'][number]) => 35 + (Date.parse(point.window.endAt) - start) / duration * 490;
  const y = (value: number) => 120 - value / maximum * 98;
  function path(series: 'earlier' | 'later') {
    let drawing = false;
    let previousEnd: string | undefined;
    return points.map(point => {
      const value = point[series];
      if (value === null) { drawing = false; previousEnd = point.window.endAt; return ''; }
      const connected = drawing && previousEnd === point.window.startAt;
      drawing = true;
      previousEnd = point.window.endAt;
      return `${connected ? 'L' : 'M'}${x(point).toFixed(2)},${y(value).toFixed(2)}`;
    }).join(' ');
  }
  return <svg className="weather-history-chart" viewBox="0 0 540 155" role="img" aria-labelledby={title}>
    <title id={title}>Earlier and later predicted solar radiation at {comparison.site.locationId}. Gaps indicate missing data. Values are also in the interval table.</title>
    <path className="weather-history-axis" d="M35 18V120H525" />
    <text x="30" y="25" textAnchor="end">{Math.round(maximum)}</text>
    <text x="30" y="123" textAnchor="end">0</text>
    <text x="35" y="140">{utc(points[0].window.endAt)}</text>
    <text x="525" y="140" textAnchor="end">{utc(points.at(-1)!.window.endAt)}</text>
    <path className="weather-history-earlier" d={path('earlier')} />
    <path className="weather-history-later" d={path('later')} />
    {(['earlier', 'later'] as const).flatMap(series => points.map((point, index) => {
      const value = point[series];
      const before = points[index - 1];
      const after = points[index + 1];
      const connectedBefore = before?.[series] != null && before.window.endAt === point.window.startAt;
      const connectedAfter = after?.[series] != null && point.window.endAt === after.window.startAt;
      return value !== null && !connectedBefore && !connectedAfter
        ? <circle key={`${series}-${point.window.startAt}`} className={`weather-history-${series}`} cx={x(point)} cy={y(value)} r="2" /> : null;
    }))}
  </svg>;
}

/** Reads saved evidence on inspection; opening history never refreshes the upstream provider. */
export function WeatherHistory({ revision }: { revision: string | null }) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [earlier, setEarlier] = useState('');
  const [later, setLater] = useState('');
  const [site, setSite] = useState('');
  const [comparison, setComparison] = useState<Comparison>();
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(undefined);
    setComparison(undefined);
    void readJson<{ revisions: Revision[]; basis: string }>('/api/weather/revisions', controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        const saved = value.revisions.slice(0, 20);
        setRevisions(saved);
        setEarlier(current => saved.some(item => item.revision === current) ? current : saved[1]?.revision ?? '');
        setLater(current => saved.some(item => item.revision === current) ? current : saved[0]?.revision ?? '');
      }).catch(error => {
        if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Saved forecast history could not be read.');
      }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [open, revision]);

  const earlierCapture = revisions.find(item => item.revision === earlier);
  const laterCapture = revisions.find(item => item.revision === later);
  const sites = (earlierCapture?.sites ?? []).filter(candidate => laterCapture?.sites.some(item =>
    item.locationId === candidate.locationId && item.latitude === candidate.latitude && item.longitude === candidate.longitude));
  const selectedSite = sites.some(item => item.locationId === site) ? site : sites[0]?.locationId ?? '';

  useEffect(() => {
    setComparison(undefined);
    setComparisonError(undefined);
    if (!open || historyLoading || historyError || !earlier || !later || earlier === later || !selectedSite) return;
    const controller = new AbortController();
    setComparisonLoading(true);
    const query = new URLSearchParams({ earlier, later, site: selectedSite });
    void readJson<Comparison>(`/api/weather/compare?${query}`, controller.signal)
      .then(value => { if (!controller.signal.aborted) setComparison(value); })
      .catch(error => {
        if (!controller.signal.aborted) setComparisonError(error instanceof Error ? error.message : 'Forecast revisions could not be compared.');
      }).finally(() => { if (!controller.signal.aborted) setComparisonLoading(false); });
    return () => controller.abort();
  }, [open, earlier, later, selectedSite, historyLoading, historyError]);

  return <details className="weather-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Forecast history</summary>
    {open && <div className="weather-history-body">
      <p>Open-Meteo forecasts · Best Match model selection. Issue time is not supplied; captures retain their original retrieval time.</p>
      {historyLoading ? <p role="status">Loading saved forecasts…</p>
        : historyError ? <p className="weather-history-error" role="alert">{historyError}</p>
          : !revisions.length ? <p>No saved forecast revisions yet.</p>
            : revisions.length < 2 ? <p>One saved forecast, received {utc(revisions[0].retrievedAt)}. A later capture is needed to compare revisions.</p>
              : <>
                <div className="weather-history-controls">
                  <label>Earlier capture<select value={earlier} onChange={event => setEarlier(event.target.value)}>
                    {revisions.map(item => <option key={item.revision} value={item.revision}>{captureLabel(item)}</option>)}
                  </select></label>
                  <label>Later capture<select value={later} onChange={event => setLater(event.target.value)}>
                    {revisions.map(item => <option key={item.revision} value={item.revision}>{captureLabel(item)}</option>)}
                  </select></label>
                  <label>Illustrative site<select value={selectedSite} onChange={event => setSite(event.target.value)} disabled={!sites.length}>
                    {sites.map(item => <option key={item.locationId} value={item.locationId}>{item.locationId} · {item.latitude}, {item.longitude}</option>)}
                  </select></label>
                </div>
                <p className="weather-history-count">{revisions.length} most recent saved captures. Radiation is a preceding-hour average in W/m².</p>
                {earlier === later ? <p>Choose two different captures.</p> : !sites.length ? <p>These captures have no common site coordinates.</p>
                  : comparisonLoading ? <p role="status">Comparing saved forecasts…</p>
                    : comparisonError ? <p className="weather-history-error" role="alert">{comparisonError}</p>
                      : comparison && <>
                        <p className="weather-history-legend"><span>Earlier forecast</span><span>Later forecast</span></p>
                        <RevisionChart comparison={comparison} />
                        <p>{comparison.commonWindow ? `Common interval: ${utc(comparison.commonWindow.startAt)} – ${utc(comparison.commonWindow.endAt)}.` : 'No overlapping forecast intervals.'}</p>
                        <p>{comparison.note}</p>
                        {comparison.points.length > 0 && <details className="weather-history-values">
                          <summary>Interval values ({Math.min(24, comparison.points.length)} of {comparison.points.length})</summary>
                          <div className="weather-history-table"><table>
                            <caption>Forecast revision changes, W/m². All times UTC; missing values remain missing.</caption>
                            <thead><tr><th>Hour ending</th><th>Earlier</th><th>Later</th><th>Change</th></tr></thead>
                            <tbody>{comparison.points.slice(0, 24).map(point => <tr key={point.window.startAt}>
                              <th scope="row">{utc(point.window.endAt)}</th><td>{number(point.earlier)}</td><td>{number(point.later)}</td><td>{number(point.change)}</td>
                            </tr>)}</tbody>
                          </table></div>
                        </details>}
                      </>}
              </>}
    </div>}
  </details>;
}
