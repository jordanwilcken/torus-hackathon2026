// Test-only composition preserving the legacy fixed-data regression scenarios.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StarterFlow } from '../../../src/ui/StarterFlow';
import { JobStream } from '../../../src/core/jobs/jobStream';
import { getFakeJob } from '../../fixtures/legacy/jobs/getFakeJob';
import { routeFakeJob } from '../../fixtures/legacy/scheduling/fakeRouter';
import { createFakeEnergyMap, getFakeEnergyMap } from '../../fixtures/legacy/energy/fakeEnergyMap';
import { getEnergyMap } from '../../../src/core/energy/getEnergyMap';
import staleInputs from '../../fixtures/legacy/energy/stale-sites.json';
import recordedInputs from '../../fixtures/legacy/reporting/execution.json';
import type { Job } from '../../../src/core/jobs/Job.type';
import type { ExecutionRun } from '../../../src/core/reporting/ExecutionEvidence.type';
import { summarizeExecution } from '../../../src/core/reporting/impact/summarizeExecution';
import { LiveGridInputs } from '../../../src/ui/energy/LiveGridInputs';
import { createPublicGridClient } from '../../../src/data/createPublicGridClient';
import { LocalExecution } from '../../../src/ui/jobs/LocalExecution';
import '../../../src/style.css';
import '../../../src/ui/DemoApplication.css';

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
      <header className="demo-heading">
        <div><h1>Sunchaser</h1><p>Compute coordinated with Torus energy.</p></div>
        <p className="demo-scope">Public grid inputs and real CPU output, alongside a modeled comparison of when to run GPU work.</p>
      </header>
      <a href="/">Open the working demo</a>
      <LiveGridInputs feeds={publicGrid} />
      <LocalExecution />
      <StarterFlow stream={stream} jobSource={jobSource} queryEnergy={queryEnergy}
        previewLabel={recorded ? 'Supplied simulation records — this application has not executed the work.' : undefined}
        reportSource={{ fake: true, label: recorded ? recordedInputs.label : 'Observed Fake job flow — no work has executed.' }} />
    </main>
  </StrictMode>,
);
