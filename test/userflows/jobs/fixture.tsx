import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Job } from '../../../src/core/jobs/Job.type';
import type { JobState } from '../../../src/core/jobs/JobState.type';
import { getFakeJob } from '../../fixtures/legacy/jobs/getFakeJob';
import { fakeEnergyMap, getFakeEnergyMap } from '../../fixtures/legacy/energy/fakeEnergyMap';
import { chooseExecutionSlot } from '../../../src/core/scheduling/chooseExecutionSlot';
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type';
import { EnergyBasemap } from '../../../src/ui/energy/EnergyBasemap';
import { JobDetails, JobSubmission, type JobDetailEvidence } from '../../../src/ui/jobs/JobSubmission';
import '../../../src/style.css';
import './fixture.css';

const seed = getFakeJob('preview-job-1');
const map = getFakeEnergyMap({ window: seed.window, asOf: seed.readyAt,
  locations: seed.allowedLocations, computeProfile: seed.computeProfile });
const locations = [...map.sites.values()].map(site => ({ id: site.id, name: site.name ?? site.id,
  detail: site.id === seed.homeLocation ? 'Job origin' : 'Supplied solar and storage example' }));
const received: Job[] = [];
let hold = false, failure: string | undefined, release: (() => void) | undefined;
let showState: (state: JobState, details?: JobDetailEvidence) => void = () => {};

Object.assign(window, { jobPreview: {
  read: () => structuredClone(received),
  initial: () => structuredClone(seed),
  setHold: (value: boolean) => { hold = value; },
  failNext: (message: string) => { failure = message; },
  release: () => release?.(),
  showState: (state: JobState, details?: JobDetailEvidence) => showState(state, details),
} });

function Preview() {
  const [initialJob, setInitialJob] = useState(seed);
  const [visibleJob, setVisibleJob] = useState(seed);
  const [details, setDetails] = useState<JobDetailEvidence>();
  const [outcome, setOutcome] = useState<JobOutcome>();
  const [routeAttempt, setRouteAttempt] = useState(0);
  showState = (state, evidence) => {
    setVisibleJob(previous => ({ ...previous, state }));
    setDetails(evidence);
  };
  async function submit(job: Job) {
    received.push(structuredClone(job));
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (failure) {
      const message = failure;
      failure = undefined;
      throw new Error(message);
    }
    const result = await chooseExecutionSlot(job, fakeEnergyMap, {
      asOf: seed.readyAt, maximumAgeMinutes: 5, kWhPerGpuHour: 1,
      transferTo: () => ({ hours: 0, costUsd: 0 }),
    });
    setOutcome(result);
    setRouteAttempt(attempt => attempt + 1);
    setDetails({ decisions: [{ at: seed.readyAt, reason: result.explanation }] });
    setVisibleJob(job);
    setInitialJob({ ...seed, id: 'preview-job-' + (received.length + 1) });
  }
  return <main className="job-preview">
    <header><h1>Sunchaser</h1><p>Job editor preview · Fake energy · no execution</p></header>
    <EnergyBasemap sites={map.sites} placement={{ job: visibleJob, outcome, routeAttempt }}
      inspection={{ focusSlot: outcome?.selected ? outcome.allocation.slot : undefined, onInspect: () => {}, onPreview: () => {}, onRegion: () => {}, onDismiss: () => {} }}
      detailCard={{}}>
      <div className="job-preview-launcher"><JobSubmission initialJob={initialJob} locations={locations} onSubmit={submit} /></div>
      <aside className="job-preview-details">
        {outcome && <section className="job-preview-result" role="status" aria-label="Routing result" data-selected={outcome.selected}>
          <strong>{outcome.selected
            ? 'Selected · ' + map.sites.get(outcome.allocation.slot.locationId)?.name
            : 'No site selected'}</strong>
          <p>{outcome.explanation}</p>
          <small>Selection only · execution not started.</small>
        </section>}
        <JobDetails job={visibleJob} details={details} />
        <p className="job-preview-assumptions">Preview inputs: 1 kWh/GPU-hour · zero transfer time/cost.</p>
      </aside>
    </EnergyBasemap>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
