import { useEffect, useRef, useState } from 'react';
import type { PublicGridClient } from '../data/createPublicGridClient';
import { LiveFleet } from './fleet/LiveFleet';
import { LocalExecution } from './jobs/LocalExecution';
import { ReplayShowcase } from './replay/ReplayShowcase';
import './DemoWorkspace.css';

type Tool = 'Run CPU work' | null;
export function DemoWorkspace({ grid }: { grid: PublicGridClient }) {
  const initialLab = new URLSearchParams(location.search).get('scenario') === 'paired-replay';
  const [lab, setLab] = useState(initialLab);
  const [fleetOpened, setFleetOpened] = useState(!initialLab);
  const [labOpened, setLabOpened] = useState(initialLab);
  const [tool, setTool] = useState<Tool>(() => new URLSearchParams(location.search).has('run') ? 'Run CPU work' : null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (tool && !dialog.current?.open) dialog.current?.showModal();
    if (!tool && dialog.current?.open) dialog.current.close();
  }, [tool]);
  function openTool(value: Tool) { setTool(value); }
  return <main className="demo-workspace">
    <header className="workspace-header">
      <div className="workspace-brand"><h1>Sunchaser</h1><span>Compute follows energy</span></div>
      <nav aria-label="Demo flow" className="workspace-tools">
        <a href="#fleet" aria-label="Live fleet" aria-current={!lab ? 'page' : undefined} onClick={event => { event.preventDefault(); setFleetOpened(true); setLab(false); setTool(null); }}>Fleet</a>
        <a href="#actual-work" aria-label="Run CPU work" onClick={event => { event.preventDefault(); openTool('Run CPU work'); }}>Run CPU <span className="workspace-real">REAL</span></a>
        <a href="#modeled-comparison" aria-label="Compare scheduling" aria-current={lab ? 'page' : undefined} onClick={event => { event.preventDefault(); setLabOpened(true); setLab(true); setTool(null); }}>Scenario lab</a>
      </nav>
    </header>
    {fleetOpened && <div id="fleet" hidden={lab}><LiveFleet grid={grid} /></div>}
    {labOpened && <section hidden={!lab} id="modeled-comparison" className="workspace-lab" aria-label="Scenario lab">
      <header><div><p className="eyebrow">CONTROLLED COMPARISON</p><h2>What changes with smarter scheduling?</h2></div><span className="fleet-mode">Modeled scenarios</span></header>
      <ReplayShowcase />
    </section>}
    <dialog ref={dialog} className="workspace-drawer" aria-label={tool ?? 'Demo tools'} onCancel={() => setTool(null)} onClick={event => { if (event.target === event.currentTarget) setTool(null); }}>
      <div className="workspace-drawer-content">
        <button className="workspace-dismiss" aria-label="Close tool" onClick={() => setTool(null)}>×</button>
        <div hidden={tool !== 'Run CPU work'} id="actual-work"><LocalExecution compact /></div>
      </div>
    </dialog>
  </main>;
}
