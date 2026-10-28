import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StarterFlow } from './ui/StarterFlow';
import { JobStream } from './core/jobs/jobStream';
import { getFakeJob } from './core/jobs/fakes/getFakeJob';
import { routeFakeJob } from './core/scheduling/fakes/fakeRouter';
import { createFakeEnergyMap, getFakeEnergyMap } from './core/energy/fakes/fakeEnergyMap';
import { getEnergyMap } from './core/energy/getEnergyMap';
import staleInputs from './core/energy/fakes/stale-sites.json';
import recordedInputs from './core/reporting/fakes/execution.json';
import type { Job } from './core/jobs/Job.type';
import type { ExecutionRun } from './core/reporting/ExecutionEvidence.type';
import { summarizeExecution } from './core/reporting/impact/summarizeExecution';
import { LiveGridInputs } from './ui/energy/LiveGridInputs';
import { createPublicGridClient } from './data/createPublicGridClient';
import './style.css';

const publicGrid = createPublicGridClient();
const stream = new JobStream(routeFakeJob);
const scenario = new URLSearchParams(location.search).get('scenario');
const recorded = scenario === 'recorded-comparison';
const preview = (scenario === 'stale-site' ? staleInputs.job : recorded ? recordedInputs.job : getFakeJob()) as Job;
const staleMap = createFakeEnergyMap(staleInputs as Parameters<typeof createFakeEnergyMap>[0], {});
const queryEnergy = scenario === 'stale-site'
  ? (query: Parameters<typeof getEnergyMap>[0]) => getEnergyMap(query, staleMap)
  : getFakeEnergyMap;
let jobNumber = 0;
const jobSource = {
  preview,
  label: 'Fake job',
  next: () => ({ ...structuredClone(preview), id: ++jobNumber === 1 ? preview.id : preview.id + '-' + jobNumber }),
};

if (recorded) {
  void stream.submit(jobSource.next()).then(() => {
    stream.observe(summarizeExecution(recordedInputs.baseline as ExecutionRun));
    stream.observe(summarizeExecution(recordedInputs.selected as ExecutionRun));
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Sunchaser</h1>
      <p>Compute coordinated with Torus energy.</p>
      <LiveGridInputs feeds={publicGrid} />
      <StarterFlow stream={stream} jobSource={jobSource} queryEnergy={queryEnergy}
        previewLabel={recorded ? 'Supplied simulation records — this application has not executed the work.' : undefined}
        reportSource={{ fake: true, label: recorded ? recordedInputs.label : 'Observed Fake job flow — no work has executed.' }} />
    </main>
  </StrictMode>,
);
