import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import { summarizeFleet } from './summarizeFleet';
import './FleetSummary.css';

const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const percent = (value: number, total: number) => total > 0 ? Math.min(100, Math.max(0, value / total * 100)) : 0;

export function FleetSummary({ progress }: { progress: ReplayProgress }) {
  const { work, energy, storage, carbon, comparison } = summarizeFleet(progress);
  const suppliedKWh = energy.solarUsedKWh + energy.gridImportKWh;
  const workPercent = percent(work.completedGpuH, work.totalGpuH);
  const solarPercent = percent(energy.solarUsedKWh, suppliedKWh);
  const comparisonLabel = comparison.status === 'comparable'
    ? signed.format(comparison.carbonReductionKg!) + ' kg reduction vs baseline'
    : comparison.status === 'pending' ? 'Comparison pending' : 'Comparison unavailable';

  return <section className="fleet-summary" aria-label="Modeled fleet summary">
    <div className="fleet-summary-caption"><span>MODELED FLEET</span><small>Current run · model receipts</small></div>
    <div className="fleet-summary-grid">
      <article className="fleet-summary-tile">
        <h3>GPU batch work</h3>
        <p className="fleet-summary-value"><strong>{format.format(work.completedGpuH)}</strong><span>/ {format.format(work.totalGpuH)} GPU·h</span></p>
        <progress aria-label="Modeled GPU work completed" max={100} value={workPercent} />
        <p className="fleet-summary-detail">{format.format(workPercent)}% completed</p>
      </article>
      <article className="fleet-summary-tile">
        <h3>Site energy supplied</h3>
        <p className="fleet-summary-value"><strong>{energy.hasReceipts ? format.format(suppliedKWh) : 'Pending'}</strong>{energy.hasReceipts && <span>kWh</span>}</p>
        <div className="fleet-summary-energy" role="img" aria-label={energy.hasReceipts
          ? 'Modeled site supply: ' + format.format(energy.solarUsedKWh) + ' kWh solar used and ' + format.format(energy.gridImportKWh) + ' kWh grid import'
          : 'Awaiting modeled site energy receipts'}>
          <span className="fleet-summary-solar" style={{ width: solarPercent + '%' }} />
          <span className="fleet-summary-grid-energy" style={{ width: suppliedKWh > 0 ? 100 - solarPercent + '%' : '0%' }} />
        </div>
        <p className="fleet-summary-detail fleet-summary-legend"><span><i className="fleet-summary-solar" />Solar {format.format(energy.solarUsedKWh)}</span><span><i className="fleet-summary-grid-energy" />Grid {format.format(energy.gridImportKWh)}</span></p>
        <small className="fleet-summary-note">Includes storage charging</small>
      </article>
      <article className="fleet-summary-tile">
        <h3>Battery stored now</h3>
        <p className="fleet-summary-value"><strong>{format.format(storage.storedKWh)}</strong><span>/ {format.format(storage.capacityKWh)} kWh</span></p>
        <progress aria-label="Modeled stored battery energy" max={100} value={percent(storage.storedKWh, storage.capacityKWh)} />
        <p className="fleet-summary-detail">Across {progress.scenario.sites.length} modeled sites</p>
      </article>
      <article className="fleet-summary-tile">
        <h3>Modeled carbon</h3>
        <p className="fleet-summary-value"><strong>{carbon.kg === null ? carbon.status === 'pending' ? 'Pending' : 'Unknown' : format.format(carbon.kg)}</strong>{carbon.kg !== null && <span>kg</span>}</p>
        <p className="fleet-summary-detail">{carbon.status === 'unknown' ? 'A receipt has no carbon value' : 'Site consumption + transfers'}</p>
        <small className="fleet-summary-note" data-comparison={comparison.status} data-reduction-kg={comparison.carbonReductionKg ?? undefined}>{comparisonLabel}</small>
      </article>
    </div>
  </section>;
}
