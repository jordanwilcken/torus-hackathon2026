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
import { LocalExecution } from './ui/jobs/LocalExecution';
import { ReplayShowcase } from './ui/replay/ReplayShowcase';
import './style.css';
import './ui/DemoApplication.css';

const publicGrid = createPublicGridClient();
const stream = new JobStream(routeFakeJob);
const scenario = new URLSearchParams(location.search).get('scenario');
const legacyPreview = ['fake-preview', 'stale-site', 'recorded-comparison'].includes(scenario ?? '');
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
      {legacyPreview ? <>
      <a href="/">Open the working demo</a>
      <LiveGridInputs feeds={publicGrid} />
      <LocalExecution />
      <StarterFlow stream={stream} jobSource={jobSource} queryEnergy={queryEnergy}
        previewLabel={recorded ? 'Supplied simulation records — this application has not executed the work.' : undefined}
        reportSource={{ fake: true, label: recorded ? recordedInputs.label : 'Observed Fake job flow — no work has executed.' }} />
      </> : <>
        <nav className="demo-navigation" aria-label="Demo flow">
          <a href="#public-inputs"><span aria-hidden="true">01</span>Public inputs</a>
          <a href="#actual-work"><span aria-hidden="true">02</span>Run CPU work</a>
          <a href="#modeled-comparison"><span aria-hidden="true">03</span>Compare scheduling</a>
        </nav>
        <div id="modeled-comparison" className="demo-section">
          <div className="demo-section-heading"><h2>Schedule with the sun</h2>
            <p>Step through computed decisions and work receipts. The model uses declared site inputs; it is separate from the public feeds and CPU worker below.</p></div>
          <ReplayShowcase />
        </div>
        <div id="public-inputs" className="demo-section"><LiveGridInputs feeds={publicGrid} /></div>
        <div id="actual-work" className="demo-section"><LocalExecution /></div>
      </>}
    </main>
  </StrictMode>,
);
