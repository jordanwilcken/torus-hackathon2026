import { useState } from 'react';
import { getFakeJob } from '../core/jobs/fakes/getFakeJob';
import { getFakeEnergyMap } from '../core/energy/fakes/fakeEnergyMap';
import { routeFakeJob } from '../core/scheduling/fakes/fakeRouter';
import { reportableJob, withReporting } from '../core/reporting/impact/reportableJob';
import { createJobReport } from '../core/reporting/getJobReport';

const value = (amount: number | undefined, prefix = '') =>
  amount === undefined ? 'Unavailable' : prefix + amount.toFixed(2);

export function StarterFlow() {
  const [job] = useState(getFakeJob);
  const [observer] = useState(() => reportableJob(job.id));
  const routeObservedJob = withReporting(routeFakeJob, observer);
  const readObservedReport = () => createJobReport(observer.readObservations(), {
    fake: true, label: 'Observed Fake job flow — no work has executed.',
  });
  const [report, setReport] = useState(readObservedReport);
  const [map] = useState(() => getFakeEnergyMap({
    window: job.window, asOf: job.readyAt,
    locations: job.allowedLocations, computeProfile: job.computeProfile,
  }));
  const outcome = report.routingOutcome;
  const routing = report.submittedJob !== undefined && outcome === undefined && report.routingFailure === undefined;

  async function submitJob() {
    const pending = routeObservedJob(job);
    setReport(readObservedReport());
    await pending.catch(() => undefined);
    setReport(readObservedReport());
  }

  const allocation = report.routingOutcome?.selected ? report.routingOutcome.allocation : undefined;
  const selectedWindow = allocation?.energy[0]?.window;
  const carbonForecast = allocation?.forecast.carbon;
  const carbonForecastPoint = carbonForecast?.points[0];

  return (
    <div className="starter-flow">
      <p className="preview-label">Fake preview — fixed data; no work is executed.</p>
      {report.routingFailure !== undefined && <p role="alert">Routing failed: {report.routingFailure}</p>}

      <section aria-labelledby="job-heading">
        <h2 id="job-heading">Job</h2>
        <p>{job.id} · {job.workGpuH} GPU-hour · maximum {job.maxGpus} GPU</p>
        <p>Window: {job.window.startAt} → {job.window.endAt}</p>
        <button onClick={submitJob} disabled={routing}>
          {routing ? 'Selecting…' : 'Submit Fake job'}
        </button>
        {routing && <p role="status">Routing…</p>}
        {outcome && <div role="status">
          <p>{outcome.selected
            ? `Selected ${map.sites.get(outcome.allocation.slot.locationId)?.name ?? outcome.allocation.slot.locationId} · ${outcome.allocation.allocatedGpus} GPU`
            : 'No slot selected'}</p>
          <p>{outcome.explanation}</p>
        </div>}
      </section>

      <section aria-labelledby="map-heading">
        <h2 id="map-heading">Energy map data</h2>
        <p>Read at {map.asOf} · {map.label}</p>
        <div className="table-scroll">
          <table aria-label="Energy slot readings">
            <thead><tr><th>Location</th><th>Posted USD/GPU-hour</th><th>Evidence</th></tr></thead>
            <tbody>{[...map.sites.values()].flatMap(site => site.slots.map(reading =>
              <tr key={site.id + ':' + reading.reference.slotId}>
                <th scope="row">{site.name ?? site.id}</th>
                <td>{value(reading.snapshot.slot?.postedUsdPerGpuHour, '$')}</td>
                <td>{reading.snapshot.status}{reading.snapshot.simulated ? ' · simulated' : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {map.sites.size === 0 && <p>No matching site readings.</p>}
      </section>

      <section aria-labelledby="report-heading">
        <h2 id="report-heading">Job report</h2>
        <p>Updates automatically as the job is submitted and routed.</p>
        {!report.submittedJob && <p>No job has been submitted.</p>}
        {report.submittedJob && <>
          <p>{report.label}</p>
          <p>Submitted job: {report.submittedJob.id}</p>
          <p>Requested work: {report.submittedJob.workGpuH} GPU-hour</p>
          {allocation && <>
            <p>Selected location: {map.sites.get(allocation.slot.locationId)?.name ?? allocation.slot.locationId}</p>
            {selectedWindow && <p>Selected window: {selectedWindow.startAt} → {selectedWindow.endAt}</p>}
            <p>Posted price: {value(allocation.postedUsdPerGpuHour, '$')}/GPU-hour</p>
            {carbonForecast && carbonForecastPoint && <p>Carbon forecast: {carbonForecastPoint.value} {carbonForecast.unit} · {carbonForecast.source}</p>}
          </>}
          {report.routingOutcome && <p>{report.routingOutcome.explanation}</p>}
          <p>{report.scenario}</p>
          <p>Comparison: {report.comparison}</p>
          <div className="table-scroll">
            <table aria-label="Observed impact report">
              <thead><tr><th>Measure</th><th>Baseline</th><th>Selected</th></tr></thead>
              <tbody>
                <tr><th scope="row">Carbon (kg CO₂)</th><td>{value(report.carbon.baselineCarbonKg)}</td><td>{value(report.carbon.selectedCarbonKg)}</td></tr>
                <tr><th scope="row">Modeled cost (USD)</th><td>{value(report.cost.baselineModeledCostUsd, '$')}</td><td>{value(report.cost.selectedModeledCostUsd, '$')}</td></tr>
              </tbody>
            </table>
          </div>
          <p>{report.carbon.accountingBasis ?? report.carbon.unavailableReason}</p>
          <p>{report.cost.costBasis ?? report.cost.unavailableReason}</p>
        </>}
      </section>
    </div>
  );
}
