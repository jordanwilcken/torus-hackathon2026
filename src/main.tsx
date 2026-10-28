import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveGridInputs } from './ui/energy/LiveGridInputs';
import { createPublicGridClient } from './data/createPublicGridClient';
import { LocalExecution } from './ui/jobs/LocalExecution';
import { LiveFleet } from './ui/fleet/LiveFleet';
import { ReplayShowcase } from './ui/replay/ReplayShowcase';
import './style.css';
import './ui/DemoApplication.css';

const publicGrid = createPublicGridClient();

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    <main>
      <header className="demo-heading">
        <div><h1>Sunchaser</h1><p>Compute coordinated with Torus energy.</p></div>
        <p className="demo-scope">Public inputs. Modeled fleet coordination. Actual CPU proof.</p>
      </header>
      <LiveFleet grid={publicGrid} />
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
    </main>
  </StrictMode>,
);
