import type { HourlyCapacityPlan } from '../../core/energy/planning/CapacityPlan.types';
import type { MoveDecision } from '../../core/scheduling/decideJobMove';
import './EngineSignals.css';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function CapacityHorizon({ plan, locationId }: { plan?: HourlyCapacityPlan; locationId: string }) {
  if (!plan) return null;
  const slots = plan.slots.filter(slot => slot.locationId === locationId);
  const maximum = Math.max(1, ...slots.map(slot => slot.physicalFreeGpus + slot.usedGpus));
  const jobs = plan.deadlines.filter(job => job.locationId === locationId);
  const covered = jobs.filter(job => job.status === 'covered').length;
  return <section className="fleet-engine-plan" aria-label="Hourly compute plan">
    <div><strong>Hourly GPU caps</strong><span>Conditional</span></div>
    <div className="fleet-cap-horizon" role="img" aria-label="Opened compute capacity by model hour">
      {slots.map(slot => <span key={slot.slotId} data-status={slot.status}
        title={`${slot.window.startAt.slice(11,16)} UTC · ${slot.capGpus} GPUs opened / ${slot.physicalFreeGpus + slot.usedGpus} physically supported · ${slot.reason}`}>
        <i className="fleet-cap-physical" style={{ height: (slot.physicalFreeGpus + slot.usedGpus) / maximum * 100 + '%' }} />
        <i className="fleet-cap-open" style={{ height: slot.capGpus / maximum * 100 + '%' }} />
      </span>)}
    </div>
    <div className="fleet-cap-labels"><small>{slots[0]?.window.startAt.slice(11,16)} UTC</small><small>{slots.at(-1)?.window.endAt.slice(11,16)} UTC</small></div>
    <p title={plan.reasons.join(' ') || 'A shared-capacity schedule fits the remaining deadlines; future inputs and execution must be rechecked.'}>
      <i data-warning={plan.mode === 'degraded'} />{covered}/{jobs.length} jobs fit · {Math.round(plan.safetyMargin * 100)}% margin target
    </p>
    <small>Green: opened · pale: physical limit</small>
  </section>;
}

export function MoveSignal({ decision, destinationName }: { decision?: MoveDecision; destinationName?: string }) {
  if (!decision) return null;
  const net = decision.netCarbonReductionKg;
  return <section className="fleet-move-signal" aria-label="Carbon-aware move decision" data-move={decision.move}>
    <div><strong>{decision.move ? '↗ Move worthwhile' : '● Stay'}</strong><span>{destinationName ?? decision.destinationLocationId} · modeled</span></div>
    {net !== undefined && <p><b>{number(net * 1000)} g</b><span>net carbon benefit</span></p>}
    <small>{decision.reason}</small>
  </section>;
}
