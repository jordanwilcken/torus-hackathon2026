import type { HourlyCapacityPlan } from '../../core/energy/planning/CapacityPlan.types';
import type { MoveDecision } from '../../core/scheduling/decideJobMove';
import type { TransferOutcome } from '../../core/execution/TransferOutcome.type';
import './EngineSignals.css';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function CapacityHorizon({ plan, locationId }: { plan?: HourlyCapacityPlan; locationId: string }) {
  if (!plan) return null;
  const slots = plan.slots.filter(slot => slot.locationId === locationId);
  const maximum = Math.max(1, ...slots.map(slot => slot.physicalFreeGpus + slot.usedGpus));
  const jobs = plan.deadlines.filter(job => job.locationId === locationId);
  const covered = jobs.filter(job => job.status === 'covered').length;
  return <section className="fleet-engine-plan" aria-label="Hourly compute plan">
    <div><strong>Compute schedule ahead</strong><span>Conditional</span></div>
    <div className="fleet-cap-horizon" role="img" aria-label="Opened compute capacity by model hour">
      {slots.map(slot => <span key={slot.slotId} data-status={slot.status}
        title={`${slot.window.startAt.slice(11,16)} UTC · ${slot.capGpus} GPUs opened / ${slot.physicalFreeGpus + slot.usedGpus} physically supported · ${slot.reason}`}>
        <i className="fleet-cap-physical" style={{ height: (slot.physicalFreeGpus + slot.usedGpus) / maximum * 100 + '%' }} />
        <i className="fleet-cap-open" style={{ height: slot.capGpus / maximum * 100 + '%' }} />
      </span>)}
    </div>
    <div className="fleet-cap-labels"><small>{slots[0]?.window.startAt.slice(11,16)} UTC</small><small>{slots.at(-1)?.window.endAt.slice(11,16)} UTC</small></div>
    <p title={plan.reasons.join(' ') || (jobs.length
      ? 'A shared-capacity schedule fits the remaining deadlines; future inputs and execution must be rechecked.'
      : 'No jobs are assigned to this site in the current plan. Hourly capacity is shown above.')}>
      <i data-warning={plan.mode === 'degraded'} />{jobs.length
        ? <>{covered}/{jobs.length} jobs fit · {Math.round(plan.safetyMargin * 100)}% margin target</>
        : "No pending work in this site's plan"}
    </p>
    <small>Green: allowed GPUs · pale: site limit</small>
  </section>;
}

export function MoveSignal({ decision, destinationName, transfer }: {
  decision?: MoveDecision; destinationName?: string; transfer?: TransferOutcome;
}) {
  if (!decision) return null;
  const net = decision.netCarbonReductionKg;
  const label = !decision.move ? 'Alternative rejected' : transfer?.started ? 'Transfer accepted'
    : transfer ? 'Transfer not started' : 'Transfer proposed';
  return <section className="fleet-move-signal" aria-label="Carbon-aware move decision" data-move={decision.move}>
    <div><strong>{label}</strong><span>{destinationName ?? decision.destinationLocationId} · modeled</span></div>
    {decision.move && transfer?.started && net !== undefined && Number.isFinite(net) &&
      <p><b>{number(net * 1000)} g</b><span>estimated net carbon reduction</span></p>}
    <small>{decision.reason}</small>
    {transfer?.started && <small>Ready after transfer: {transfer.readyAt.slice(0, 16).replace('T', ' ')} UTC.</small>}
    {transfer && !transfer.started && <small>{transfer.explanation}</small>}
  </section>;
}
