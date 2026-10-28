import { useEffect, useRef, useState } from 'react';
import type { PublicGridClient } from '../data/createPublicGridClient';
import { LiveFleet } from './fleet/LiveFleet';
import { LocalExecution } from './jobs/LocalExecution';
import { ReplayShowcase } from './replay/ReplayShowcase';
import './DemoWorkspace.css';

type Tool = 'Run CPU work' | null;
const inlineToolQuery = '(max-width:760px), (hover:none) and (pointer:coarse)';
export function DemoWorkspace({ grid }: { grid: PublicGridClient }) {
  const initialLab = new URLSearchParams(location.search).get('scenario') === 'paired-replay';
  const [lab, setLab] = useState(initialLab);
  const [fleetOpened, setFleetOpened] = useState(!initialLab);
  const [labOpened, setLabOpened] = useState(initialLab);
  const [tool, setTool] = useState<Tool>(() => new URLSearchParams(location.search).has('run') ? 'Run CPU work' : null);
  const dialog = useRef<HTMLDialogElement>(null);
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  const toolsSummary = useRef<HTMLElement>(null);
  const [inlineTool, setInlineTool] = useState(() => matchMedia(inlineToolQuery).matches);
  useEffect(() => {
    const media = matchMedia(inlineToolQuery);
    const changed = () => setInlineTool(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    if (panel.open) panel.close();
    if (tool) {
      if (inlineTool) panel.show();
      else panel.showModal();
    }
  }, [tool, inlineTool]);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !toolsMenu.current?.contains(event.target))
        toolsMenu.current?.removeAttribute("open");
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  function closeTools() {
    toolsMenu.current?.removeAttribute("open");
    toolsSummary.current?.focus({ preventScroll: true });
  }
  function closeTool() {
    dialog.current?.close();
    setTool(null);
    toolsSummary.current?.focus({ preventScroll: true });
  }
  return <main className="demo-workspace" data-inline-tools={inlineTool || undefined} data-tool-open={Boolean(tool) || undefined}>
    <header className="workspace-header">
      <div className="workspace-brand"><h1>Sunchaser</h1><span>Compute follows energy</span></div>
      <nav aria-label="Demo flow" className="workspace-tools">
        <a href="#fleet" aria-label="Live fleet" aria-current={!lab && !tool ? 'page' : undefined} onClick={event => {
          event.preventDefault(); toolsMenu.current?.removeAttribute("open"); setFleetOpened(true); setLab(false); setTool(null);
        }}>Fleet</a>
        <details ref={toolsMenu} className="workspace-more" onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); closeTools(); }
        }}>
          <summary ref={toolsSummary} data-active={lab || Boolean(tool) || undefined}>More tools</summary>
          <div className="workspace-more-panel">
            <p>Optional tools</p>
            <a href="#actual-work" aria-label="Run CPU work" aria-current={tool ? 'page' : undefined} onClick={event => {
              event.preventDefault(); closeTools(); setTool('Run CPU work');
            }}><span className="workspace-more-title">Run CPU <span className="workspace-real">REAL</span></span>
              <small>Proof of an actual task running on the demo host.</small></a>
            <a href="#modeled-comparison" aria-label="Compare scheduling" aria-current={lab && !tool ? 'page' : undefined} onClick={event => {
              event.preventDefault(); closeTools(); setLabOpened(true); setLab(true); setTool(null);
            }}><span className="workspace-more-title">Scenario lab</span>
              <small>Compare scheduling with declared modeled inputs.</small></a>
          </div>
        </details>
      </nav>
    </header>
    {fleetOpened && <div id="fleet" hidden={lab || Boolean(inlineTool && tool)}><LiveFleet grid={grid} /></div>}
    {labOpened && <section hidden={!lab || Boolean(inlineTool && tool)} id="modeled-comparison" className="workspace-lab" aria-label="Scenario lab">
      <header><div><p className="eyebrow">CONTROLLED COMPARISON</p><h2>What changes with smarter scheduling?</h2></div><span className="fleet-mode">Modeled scenarios</span></header>
      <ReplayShowcase />
    </section>}
    <dialog ref={dialog} className="workspace-drawer" aria-label={tool ?? 'Demo tools'}
      onCancel={event => { event.preventDefault(); closeTool(); }}
      onKeyDown={event => { if (inlineTool && event.key === 'Escape') { event.preventDefault(); closeTool(); } }}
      onClick={event => { if (!inlineTool && event.target === event.currentTarget) closeTool(); }}>
      <button className="workspace-dismiss" aria-label="Close tool" onClick={closeTool}>×</button>
      <div className="workspace-drawer-content">
        <div hidden={tool !== 'Run CPU work'} id="actual-work"><LocalExecution compact /></div>
      </div>
    </dialog>
  </main>;
}
