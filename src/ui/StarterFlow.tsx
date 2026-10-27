import { useState } from 'react';
import { getFakeJob } from '../core/jobs/fakes/getFakeJob';
import { getFakeEnergyMap } from '../core/energy/fakes/fakeEnergyMap';
import { routeFakeJob } from '../core/scheduling/fakes/fakeRouter';
import type { JobOutcome } from '../core/scheduling/JobOutcome.type';
import { getFakeJobReport } from '../core/reporting/fakes/readFakeJobReport';
import type { JobReport } from '../core/reporting/JobReport.type';

const value = (amount: number | undefined, prefix = '') =>
  amount === undefined ? 'Unavailable' : prefix + amount.toFixed(2);

export function StarterFlow() {
  // These are the source choices for this preview; the UI supplies the Job.
  const [job] = useState(getFakeJob);
  const [map] = useState(() => getFakeEnergyMap({
    window: job.window, asOf: job.readyAt,
    locations: job.allowedLocations, computeProfile: job.computeProfile,
  }));
  const [outcome, setOutcome] = useState<JobOutcome>();
  const [report, setReport] = useState<JobReport>();
  const [pending, setPending] = useState<'route' | 'report'>();
  const [error, setError] = useState<string>();

  async function submitJob() {
    setPending('route');
    setError(undefined);
    setOutcome(undefined);
    try { setOutcome(await routeFakeJob(job)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Routing failed.'); }
    finally { setPending(undefined); }
  }

  async function readReport() {
    setPending('report');
    setError(undefined);
    setReport(undefined);
    try { setReport(await getFakeJobReport(job.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Report unavailable.'); }
    finally { setPending(undefined); }
  }

  return (
    <div className="starter-flow">
      <p className="preview-label">Fake preview — fixed data; no work is executed.</p>
      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="job-heading">
        <h2 id="job-heading">Job</h2>
        <p>{job.id} · {job.workGpuH} GPU-hour · maximum {job.maxGpus} GPU</p>
        <p>Window: {job.window.startAt} → {job.window.endAt}</p>
        <button onClick={submitJob} disabled={pending !== undefined}>
          {pending === 'route' ? 'Selecting…' : 'Submit Fake job'}
        </button>
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
        <h2 id="report-heading">Saved report</h2>
        <p>Read the saved comparison separately from routing.</p>
        <button onClick={readReport} disabled={pending !== undefined}>
          {pending === 'report' ? 'Reading…' : 'Read Fake report'}
        </button>
        {report && <>
          <p>{report.label}</p>
          <p>Comparison: {report.comparison}</p>
          <div className="table-scroll">
            <table aria-label="Saved impact comparison">
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
