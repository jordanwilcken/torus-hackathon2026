import { useEffect, useRef, useState } from 'react';
import { EnergyMapView } from './energy/EnergyMapView';
import type { Job } from '../core/jobs/Job.type';
import type { JobStream } from '../core/jobs/jobStream';
import type { JobReport } from '../core/reporting/JobReport.type';
import type { SlotQuery } from '../core/energy/SlotQuery.interface';
import type { getEnergyMap } from '../core/energy/getEnergyMap';
import { createJobReport } from '../core/reporting/getJobReport';
import type { SlotReference } from '../core/energy/SlotReference.type';

const value = (amount: number | undefined, prefix = '') =>
  amount === undefined ? 'Unavailable' : prefix + amount.toFixed(2);

type StarterFlowProps = {
  stream: JobStream;
  jobSource: { preview: Job; next: () => Job; label: string };
  queryEnergy: (query: SlotQuery) => ReturnType<typeof getEnergyMap>;
  reportSource: Pick<JobReport, 'fake' | 'label'>;
};

export function StarterFlow({ stream, jobSource, queryEnergy, reportSource }: StarterFlowProps) {
  const [jobs, setJobs] = useState(() => stream.read());
  const [activeJobId, setActiveJobId] = useState(jobs.at(-1)?.jobId);
  const latestJobId = useRef(activeJobId);
  const [inspectedSlot, setInspectedSlot] = useState<SlotReference>();
  const [focusSlot, setFocusSlot] = useState<SlotReference>();
  useEffect(() => stream.subscribe(observations => {
    setJobs(observations);
    const newest = observations.at(-1)?.jobId;
    if (newest !== latestJobId.current) {
      latestJobId.current = newest;
      setActiveJobId(newest);
    }
  }), [stream]);

  const activeJob = jobs.find(observation => observation.jobId === activeJobId);
  const job = activeJob?.submittedJob ?? jobSource.preview;
  const report = createJobReport(activeJob ?? { jobId: job.id }, reportSource);
  const map = queryEnergy({
    window: job.window, asOf: job.readyAt,
    locations: job.allowedLocations, computeProfile: job.computeProfile,
  });
  const outcome = report.routingOutcome;
  const allocation = outcome?.selected ? outcome.allocation : undefined;
  const routeAttempt = jobs.findIndex(observation => observation.jobId === activeJobId) + 1;

  useEffect(() => {
    setInspectedSlot(allocation?.slot);
    setFocusSlot(allocation?.slot);
  }, [job.id, allocation?.slot.locationId, allocation?.slot.slotId]);

  function inspect(slot: SlotReference) {
    setInspectedSlot(slot);
    setFocusSlot(slot);
  }

  function submitJob() {
    void stream.submit(jobSource.next()).catch(() => undefined);
  }

  const selectedWindow = allocation?.energy[0]?.window;
  const selectedName = allocation && (map.sites.get(allocation.slot.locationId)?.name ?? allocation.slot.locationId);

  return <div className="starter-flow">
    {reportSource.fake && <p className="preview-label"><span />Fake preview — fixed data; no work is executed.</p>}
    <section className="job-panel" aria-labelledby="job-heading">
      <div className="job-summary"><div><p className="eyebrow">TRY THE FLOW</p><h2 id="job-heading">Job</h2></div>
        <div className="job-request"><strong>{job.workGpuH} GPU-hour</strong><span>{job.id} · max {job.maxGpus} GPU</span></div>
        <div className="job-window"><strong>{job.window.startAt.slice(11, 16)}–{job.window.endAt.slice(11, 16)} UTC</strong><span>{job.window.startAt.slice(0, 10)} · Utah demo</span></div>
        <button className="route-button" onClick={submitJob}>{jobs.length ? 'Route next ' : 'Route '}{jobSource.label}</button>
      </div>
      {report.routingFailure !== undefined && <p role="alert">Routing failed: {report.routingFailure}</p>}
      {outcome && <div role="status" className="sr-only">
        <span className="receipt-number">Job {job.id}</span>
        <div><strong>{outcome.selected ? `Selected ${selectedName}` : 'No slot selected'}</strong>
          <p>{outcome.explanation}</p></div>
        {allocation && <span className="receipt-price">{value(allocation.postedUsdPerGpuHour, '$')}<small>/ GPU-hour</small></span>}
      </div>}
    </section>

    {jobs.length > 0 && <section className="job-stream" aria-label="Job stream">
      <span className="eyebrow">JOB STREAM</span>
      {jobs.map(observation => <button key={observation.jobId} className="site-choice"
        aria-label={'Inspect job ' + observation.jobId} aria-pressed={activeJobId === observation.jobId}
        onClick={() => setActiveJobId(observation.jobId)}>
        <span>{observation.jobId}</span>
        <small>{observation.routingFailure !== undefined ? 'Routing failed' : observation.routingOutcome
          ? observation.routingOutcome.selected ? 'Selected' : 'No slot selected' : 'Routing'}</small>
      </button>)}
    </section>}

    <EnergyMapView map={map} jobFlow={{ job, report, routeAttempt }}
      inspection={{ inspectedSlot, focusSlot, onInspect: inspect }} />

    <section className="job-report" aria-labelledby="report-heading">
      <div className="report-heading"><div><p className="eyebrow">OBSERVED FLOW</p><h2 id="report-heading">Job report</h2></div>
        <span className="pill">{outcome?.selected ? 'Route observed' : 'Awaiting route'}</span></div>
      {!report.submittedJob ? <p className="muted">Route the Fake job to see the selection recorded here.</p> : <>
        <ol className="job-progress"><li>Job received</li><li>{outcome?.selected ? 'Site selected' : report.routingFailure ? 'Routing failed' : outcome ? 'No slot selected' : 'Routing'}</li><li className="pending">Execution not started</li></ol>
        <p className="muted">Carbon and cost totals are unavailable until execution data arrives.</p>
        <details className="report-details"><summary>Report details</summary>
          <p>{report.label}</p><p>Submitted job: {report.submittedJob.id}</p><p>Requested work: {report.submittedJob.workGpuH} GPU-hour</p>
          {allocation && <><p>Selected location: {selectedName}</p>
            {selectedWindow && <p>Selected window: {selectedWindow.startAt} → {selectedWindow.endAt}</p>}
            <p>Posted price: {value(allocation.postedUsdPerGpuHour, '$')}/GPU-hour</p></>}
          <p>Comparison: {report.comparison}</p>
          <div className="table-scroll"><table aria-label="Observed impact report">
            <thead><tr><th>Measure</th><th>Baseline</th><th>Selected</th></tr></thead>
            <tbody><tr><th scope="row">Carbon (kg CO₂)</th><td>{value(report.carbon.baselineCarbonKg)}</td><td>{value(report.carbon.selectedCarbonKg)}</td></tr>
              <tr><th scope="row">Modeled cost (USD)</th><td>{value(report.cost.baselineModeledCostUsd, '$')}</td><td>{value(report.cost.selectedModeledCostUsd, '$')}</td></tr></tbody>
          </table></div>
          <p>{report.carbon.accountingBasis ?? report.carbon.unavailableReason}</p><p>{report.cost.costBasis ?? report.cost.unavailableReason}</p>
        </details>
      </>}
    </section>
  </div>;
}
