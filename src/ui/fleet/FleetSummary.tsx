import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import { summarizeFleet } from './summarizeFleet';
import { fleetCarbonOutcome } from './fleetCarbonOutcome';
import './FleetSummary.css';

const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number, total: number) => total > 0 ? Math.min(100, Math.max(0, value / total * 100)) : 0;
const gpuHour = 'One GPU-hour is one GPU working for one hour.';

export function FleetSummary({ progress }: { progress: ReplayProgress }) {
  const summary = summarizeFleet(progress);
  const { work, energy, storage, carbon } = summary;
  const outcome = fleetCarbonOutcome(progress, summary);
  const plan = progress.selected.plans?.at(-1);
  const suppliedKWh = energy.solarUsedKWh + energy.gridImportKWh;
  const workPercent = percent(work.completedGpuH, work.totalGpuH);
  const solarPercent = percent(energy.solarUsedKWh, suppliedKWh);
  const completedJobs = progress.selected.finalJobs.filter(job => job.state === 'done').length;

  return <section className="fleet-summary" aria-label="Modeled fleet summary">
    <div className="fleet-summary-main">
      <div className="fleet-carbon-outcome" data-outcome={outcome.status} data-tone={outcome.tone} data-reduction-kg={outcome.reductionKg ?? undefined}>
        <p className="fleet-summary-eyebrow">MODELED CARBON</p>
        <h3>{outcome.headline}{outcome.percent !== null && <span className="fleet-carbon-percent">{outcome.percent}% {outcome.reductionKg === 0 ? 'change' : outcome.tone === 'lower' ? 'less' : 'more'}</span>}</h3>
        <p className="fleet-carbon-totals">Baseline <strong>{outcome.baselineLabel}</strong><span>·</span>Scheduled <strong>{outcome.selectedLabel}</strong></p>
        <p className="fleet-carbon-qualification">{outcome.detail}</p>
      </div>
      <div className="fleet-summary-work">
        <h3 title={gpuHour}>Work completed</h3>
        <p className="fleet-summary-value"><strong>{format.format(work.completedGpuH)}</strong><span>/ {format.format(work.totalGpuH)} <abbr title={gpuHour}>GPU·h</abbr></span></p>
        <progress aria-label="Modeled GPU work completed" max={100} value={workPercent} />
        <p className="fleet-summary-detail">{completedJobs} of {progress.scenario.jobs.length} jobs · {Math.round(workPercent)}% completed</p>
      </div>
    </div>
    <details className="fleet-energy-details">
      <summary>Energy details</summary>
      <div className="fleet-energy-readings">
        <article>
          <h3>Energy supplied</h3>
          <p className="fleet-summary-value"><strong>{energy.hasReceipts ? format.format(suppliedKWh) : 'Pending'}</strong>{energy.hasReceipts && <span>kWh</span>}</p>
          <div className="fleet-summary-energy" role="img" aria-label={energy.hasReceipts
            ? 'Modeled site supply: ' + format.format(energy.solarUsedKWh) + ' kWh solar used and ' + format.format(energy.gridImportKWh) + ' kWh grid import'
            : 'Awaiting modeled site energy receipts'}>
            <span className="fleet-summary-solar" style={{ width: solarPercent + '%' }} />
            <span className="fleet-summary-grid-energy" style={{ width: suppliedKWh > 0 ? 100 - solarPercent + '%' : '0%' }} />
          </div>
          <p className="fleet-summary-detail fleet-summary-legend"><span><i className="fleet-summary-solar" />Solar {format.format(energy.solarUsedKWh)}</span><span><i className="fleet-summary-grid-energy" />Grid {format.format(energy.gridImportKWh)}</span></p>
          <small className="fleet-summary-note">Includes storage charging; excludes curtailed solar</small>
        </article>
        <article>
          <h3>Battery reserve</h3>
          <p className="fleet-summary-value"><strong>{format.format(storage.storedKWh)}</strong><span>/ {format.format(storage.capacityKWh)} kWh</span></p>
          <progress aria-label="Modeled stored battery energy" max={100} value={percent(storage.storedKWh, storage.capacityKWh)} />
          <p className="fleet-summary-detail">Across {progress.scenario.sites.length} modeled compute sites</p>
        </article>
        <article>
          <h3>Scheduled carbon receipts</h3>
          <p className="fleet-summary-value"><strong>{carbon.kg === null ? carbon.status === 'pending' ? 'Pending' : 'Unknown' : format.format(carbon.kg)}</strong>{carbon.kg !== null && <span>kg</span>}</p>
          <p className="fleet-summary-detail">{carbon.status === 'unknown' ? 'A receipt has no carbon value' : 'Site consumption + job transfers'}</p>
          <small className="fleet-summary-note">Carbon factors are model assumptions.</small>
        </article>
      </div>
      {plan && <p className="fleet-summary-planner" data-degraded={plan.mode === 'degraded'} title={plan.reasons.join(' ') || 'Shared deadline capacity; no future reservations.'}>Scheduler · {plan.deadlines.filter(job => job.status === 'covered').length}/{plan.deadlines.length} jobs conditionally fit their deadlines{plan.mode === 'degraded' ? ' · degraded mode' : ''}</p>}
    </details>
  </section>;
}
