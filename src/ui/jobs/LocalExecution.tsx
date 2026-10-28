import { useEffect, useState } from 'react';
import type { LocalRun, LocalRunRequest } from '../../data/LocalRun.type';
import type { FeedState } from '../../data/FeedState.type';
import type { EiaApiSnapshot } from '../../core/energy/data/eiaApi';
import type { CaisoSnapshot } from '../../server/caiso';
import './LocalExecution.css';

type Context = { mode: 'live' | 'recorded'; asOf: string; busy: boolean; inputs: { eia: FeedState<EiaApiSnapshot>; caiso: FeedState<CaisoSnapshot> } };
async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Request failed');
  return value;
}
export function LocalExecution() {
  const [context, setContext] = useState<Context>();
  const [run, setRun] = useState<LocalRun>();
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const [kind, setKind] = useState<'grid-summary' | 'integer-sum'>('grid-summary');
  const [values, setValues] = useState('1, 2, 3, 4');
  const [demand, setDemand] = useState('20000');
  const [price, setPrice] = useState('100');
  const [energy, setEnergy] = useState('1');
  const [efficiency, setEfficiency] = useState('90');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function loadContext() {
    try { setContext(await json<Context>('/api/jobs/context')); } catch (failure) { setError(String(failure)); }
  }
  useEffect(() => {
    void loadContext();
    const id = new URLSearchParams(location.search).get('run');
    if (id) void json<LocalRun>('/api/jobs/runs/' + encodeURIComponent(id)).then(setRun).catch(failure => setError(String(failure)));
  }, []);
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return;
    let stopped = false;
    const timer = setInterval(() => {
      void json<LocalRun>('/api/jobs/runs/' + run.id).then(value => { if (!stopped) setRun(value); })
        .catch(failure => { if (!stopped) setError(String(failure)); });
    }, 200);
    return () => { stopped = true; clearInterval(timer); };
  }, [run?.id, run?.status]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!context?.inputs.eia.revision || !context.inputs.caiso.revision) { setError('Both public input revisions are required.'); return; }
    const request: LocalRunRequest = { requestId, workload: kind === 'integer-sum'
      ? { kind, values: values.trim() ? values.split(',').map(value => Number(value.trim())) : [] } : { kind },
      inputRevisions: { eia: context.inputs.eia.revision, caiso: context.inputs.caiso.revision },
      policy: { maximumDemandMW: Number(demand), maximumWholesaleUsdPerMWh: Number(price), maximumAgeMinutes: { eia: 240, caiso: 30 } },
      model: { computeKWh: Number(energy), roundTripEfficiency: Number(efficiency) / 100 } };
    setSubmitting(true);
    try {
      const result = await json<LocalRun>('/api/jobs/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      setRun(result);
      const url = new URL(location.href); url.searchParams.set('run', result.id); history.replaceState(null, '', url);
      setRequestId(crypto.randomUUID());
    } catch (failure) { setError(String(failure)); }
    finally { setSubmitting(false); }
  }
  const available = Boolean(context?.inputs.eia.revision && context.inputs.caiso.revision);
  return <section className="local-execution" aria-label="Server execution">
    <header><h2>Run real work on the application server</h2>
      <p>Public inputs → policy decision → actual CPU execution → saved output</p></header>
    {context && <p className="input-mode">{context.mode === 'recorded' ? 'Recorded public inputs' : 'Live public inputs'} · evaluated as of {context.asOf}
      {context.mode === 'recorded' && ' · Historical input replay; the worker executes now.'}</p>}
    <p>PACE is the reference grid region. The application server’s physical grid region is unverified. The policy below uses regional demand and wholesale prices as operator-selected signals.</p>
    <button type="button" onClick={() => void loadContext()}>Refresh public inputs</button>
    {context && <ul className="input-revisions">{(['eia', 'caiso'] as const).map(feed => <li key={feed}>
      {feed.toUpperCase()} revision: {context.inputs[feed].revision ?? 'unavailable'}
    </li>)}</ul>}
    <form onSubmit={submit}>
      <label>Workload<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
        <option value="grid-summary">Analyze captured PACE demand</option><option value="integer-sum">Integer sum</option>
      </select></label>
      {kind === 'integer-sum' && <label>Integer values<input value={values} onChange={event => setValues(event.target.value)} /></label>}
      <label>Request ID<input value={requestId} onChange={event => setRequestId(event.target.value)} required /></label>
      <fieldset><legend>Server dispatch policy</legend>
        <label>Maximum PACE demand (MW)<input type="number" min="0" value={demand} onChange={event => setDemand(event.target.value)} required /></label>
        <label>Maximum wholesale price (USD/MWh)<input type="number" step="any" value={price} onChange={event => setPrice(event.target.value)} required /></label>
        <p>Reported demand must be within 240 minutes; price and retrieval age within 30 minutes for CAISO. One workload can run at a time. These settings are policy choices, not site capacity or a retail tariff.</p>
      </fieldset>
      <fieldset><legend>Separate Torus storage scenario</legend>
        <label>Assumed compute energy (kWh)<input type="number" min="0.000001" step="any" value={energy} onChange={event => setEnergy(event.target.value)} required /></label>
        <label>Assumed round-trip efficiency (%)<input type="number" min="0.01" max="100" step="any" value={efficiency} onChange={event => setEfficiency(event.target.value)} required /></label>
      </fieldset>
      <button disabled={!available || submitting} type="submit">{submitting ? 'Recording request…' : 'Run on server'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {run && <article aria-label="Saved run">
      <h3>Run {run.id}</h3><p>Status: <strong data-testid="run-status">{run.status}</strong></p>
      <h4>Decision</h4><p>{run.decision.explanation}</p><p>{run.decision.scheduler} · {run.decision.evaluatedAt}</p>
      <ul>{run.decision.inputs.map(input => <li key={input.feed}>
        {input.feed.toUpperCase()}: {input.value} {input.unit} · {input.interval.startAt} to {input.interval.endAt} · retrieved {input.retrievedAt} · {input.accepted ? 'accepted' : 'not accepted'}
        <br /><a href={`/api/grid/${input.feed}?revision=${input.revision}`} target="_blank" rel="noreferrer">Input revision {input.revision}</a>
      </li>)}</ul>
      <h4>Actual execution</h4><p>{run.execution.location === 'This computer' ? 'Application server (archived label: “This computer”)' : run.execution.location} · CPU · {run.execution.backend} · {run.execution.backend === 'node-child-process' ? ('process ' + (run.execution.pid ?? 'not started')) : 'managed JavaScript isolate; no operating-system PID'}</p>
      <p>{run.execution.events.map(event => event.state).join(' → ')}</p>
      <p>Started: {run.execution.startedAt ?? 'not started'} · Completed: {run.execution.completedAt ?? 'not completed'} · {run.execution.backend === 'node-child-process' ? ('Exit code: ' + (run.execution.exitCode ?? 'unavailable')) : 'Operating-system exit code: not applicable'}</p>
      {run.execution.error && <p role="alert">{run.execution.error}</p>}
      <p>Measured energy: unavailable · Measured carbon: unavailable · Actual electricity cost: unavailable</p>
      {run.execution.output && <><a href={`/api/jobs/runs/${run.id}/output`} download={`${run.id}.json`}>Download actual output</a>
        <p>Output SHA-256: {run.execution.output.id}</p><pre data-testid="actual-output">{run.execution.output.text}</pre></>}
      <h4>Modeled Torus storage comparison</h4><p>{run.comparison.label}</p>
      <p>Same assumed compute work: {run.comparison.computeKWh} kWh. Direct-grid input: {run.comparison.baselineGridKWh} kWh. Storage-cycle input: {run.comparison.storageGridKWh.toLocaleString('en-US', { maximumFractionDigits: 6 })} kWh.</p>
      <p>Wholesale reference difference: {run.comparison.differenceUsd === null ? 'unavailable' : `${run.comparison.differenceUsd.toFixed(6)} USD`} · Carbon: unknown</p>
      <dl>{Object.entries(run.comparison.assumptions).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      <details><summary>Saved decision and receipt</summary><pre data-testid="run-evidence">{JSON.stringify(run, null, 2)}</pre></details>
    </article>}
  </section>;
}
