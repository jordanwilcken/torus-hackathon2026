import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StarterFlow } from './ui/StarterFlow';
import { JobStream } from './core/jobs/jobStream';
import { getFakeJob } from './core/jobs/fakes/getFakeJob';
import { routeFakeJob } from './core/scheduling/fakes/fakeRouter';
import { getFakeEnergyMap } from './core/energy/fakes/fakeEnergyMap';
import './style.css';

const stream = new JobStream(routeFakeJob);
const preview = getFakeJob();
let jobNumber = 0;
const jobSource = {
  preview,
  label: 'Fake job',
  next: () => getFakeJob(++jobNumber === 1 ? preview.id : preview.id + '-' + jobNumber),
};

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Sunchaser</h1>
      <p>Compute coordinated with Torus energy.</p>
      <StarterFlow stream={stream} jobSource={jobSource} queryEnergy={getFakeEnergyMap}
        reportSource={{ fake: true, label: 'Observed Fake job flow — no work has executed.' }} />
    </main>
  </StrictMode>,
);
