import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import type { JobRoutingResult } from '../../core/scheduling/routeAndAcceptJobs';
import './FleetDecision.css';

type DecisionRecord = { hour: number; result: JobRoutingResult };
type Props = { progress: ReplayProgress; jobId?: string; onInspect: (id: string) => void };

/** Lifecycle can remain running between slots; only current accepted work is visibly running. */
export function jobActivity(progress: ReplayProgress, job: ReplayProgress['selected']['finalJobs'][number]) {
  if (job.state === 'done' || job.state === 'missed' || job.state === 'moving' || job.state === 'paused') return job.state;
  const batch = progress.selected.decisions.at(-1);
  const result = batch?.hour === progress.hour ? batch.results.find(item => item.jobId === job.id) : undefined;
  return progress.phase === 'routed' && result?.accepted && result.selection.selected ? 'running' : 'waiting';
}

function latestDecision(progress: ReplayProgress, jobId?: string): DecisionRecord | undefined {
  const batch = progress.selected.decisions.findLast(item =>
    jobId ? item.results.some(result => result.jobId === jobId) : item.results.length > 0);
  if (!batch) return undefined;
  const results = batch.results;
  const result = jobId ? results.find(item => item.jobId === jobId)
    : results.find(item => item.transfer?.started)
      ?? results.find(item => !item.selection.selected)
      ?? results.find(item => item.accepted && item.selection.selected)
      ?? results[0];
  return result && { hour: batch.hour, result };
}

function currentLocation(progress: ReplayProgress, record: DecisionRecord) {
  const { result, hour } = record;
  if (result.transfer?.started) return result.transfer.evidence.fromLocation;
  if (result.selection.selected) return result.selection.allocation.slot.locationId;
  const stay = result.selection.movement?.stay;
  if (stay?.feasible) return stay.locationId;
  const at = Date.parse(progress.scenario.startAt) + hour * 3_600_000;
  const arrived = progress.selected.run.transfers.filter(receipt =>
    receipt.jobId === result.jobId && Date.parse(receipt.window.endAt) <= at)
    .toSorted((a, b) => Date.parse(a.window.endAt) - Date.parse(b.window.endAt)).at(-1);
  const job = progress.scenario.jobs.find(item => item.id === result.jobId);
  return arrived?.toLocation ?? job?.currentLocation ?? job?.homeLocation;
}

function postedPrice(value: number) {
  return value > 0 && value < .01
    ? (value * 100 < .01 ? '<0.01' : (value * 100).toFixed(2)) + '¢'
    : '$' + value.toFixed(2);
}

/** Shorten only known contract explanations; preserve unfamiliar reasons verbatim. */
function plainReason(reason: string) {
  const exact: Record<string, string> = {
    'Avoided execution carbon does not exceed the modeled transfer carbon.': 'Moving would not reduce carbon',
    'Destination execution plus transfer is not cheaper than completing the same job here.': 'Moving would not lower total cost',
    'Transfer carbon is unknown; no carbon reduction can be established.': 'Transfer carbon is unknown',
    'Whole-job carbon is unknown on one or both paths; stay rather than infer a benefit.': 'Whole-job carbon is unknown',
    'The supplied transfer monetary burden is unknown or invalid.': 'Transfer cost is unknown or invalid',
    'Current and destination carbon accounting bases do not match.': 'Carbon accounting does not match',
    'The destination is not allowed for this job.': 'The destination is not allowed',
    'A move needs the authoritative current site and a different destination.': 'The move has no valid origin and destination',
    'Transfer arrival is invalid or leaves no execution time before the deadline.': 'Arrival is invalid or too late for the deadline',
    'This policy found no current, non-projected slot with usable capacity.': 'No current slot has usable capacity',
    'The job is not ready to execute yet.': 'The job is not ready yet',
    'The remaining work cannot finish before the deadline within the job\'s GPU limit.': 'Remaining work cannot finish before its deadline',
    'The job has no remaining ready work within a valid deadline and GPU limit.': 'No ready work within valid job limits',
    'Routing needs a valid current time, freshness limit and positive compute energy profile.': 'Time, freshness or compute profile is invalid',
    'Transfer terms are incomplete or incompatible.': 'Transfer terms are incomplete or incompatible',
    'Transfer and remaining work cannot finish before the deadline.': 'Moving would miss the deadline',
    'Known destination capacity cannot support the remaining work; future capacity is not reserved.': 'Destination capacity cannot cover the remaining work',
  };
  if (exact[reason]) return exact[reason];
  if (reason.startsWith('Waiting: supplied cheaper future slots at '))
    return 'Cheaper future slots cover this job; they are not reserved';
  if (reason.startsWith('Stay-path evidence is insufficient: '))
    return 'Current-site completion could not be established';
  if (reason.startsWith('Destination path is infeasible: '))
    return 'Destination completion could not be established';
  if (reason.startsWith('Transfer assumptions for ') && reason.endsWith(' are unavailable.'))
    return 'Transfer assumptions are unavailable';
  if (reason.startsWith('Transfer to ') && reason.endsWith(' plus the remaining work would miss the deadline.'))
    return 'Moving would miss the deadline';
  if (reason.startsWith('A transfer to ') && reason.endsWith(' is required before a current allocation can execute.'))
    return 'A transfer is required before a current allocation';
  return reason || 'No decision reason was recorded';
}

function describe(progress: ReplayProgress, record: DecisionRecord) {
  const { result } = record;
  const { selection, transfer } = result;
  const place = (id?: string) => id
    ? progress.scenario.sites.find(site => site.configuration.locationId === id)?.name ?? id
    : 'unknown location';
  const movement = selection.movement;
  const city = place(currentLocation(progress, record));
  if (transfer?.started) {
    const carbonImproves = movement?.move && movement.netCarbonReductionKg !== undefined
      && Number.isFinite(movement.netCarbonReductionKg) && movement.netCarbonReductionKg > 0;
    const costImproves = movement?.stayCostUsd !== undefined && movement.moveCostUsd !== undefined
      && Number.isFinite(movement.stayCostUsd) && Number.isFinite(movement.moveCostUsd)
      && movement.moveCostUsd < movement.stayCostUsd;
    return {
      state: 'moving',
      action: 'Move started → ' + place(transfer.evidence.toLocation),
      reason: movement?.move && movement.stay?.feasible === false && movement.destination?.feasible === true
        ? 'Move to preserve the deadline; comparative carbon savings unavailable. ' +
          (result.accepted && selection.selected ? 'Destination compute accepted' : 'Destination compute still requires acceptance')
        : carbonImproves
        ? costImproves ? 'Lower modeled carbon and cost, including transfer' : 'Lower modeled carbon after transfer; total cost comparison unknown'
        : result.accepted && selection.selected
          ? 'Transfer started; destination compute accepted at ' + postedPrice(selection.allocation.postedUsdPerGpuHour) + '/GPU·h'
          : 'Transfer started; destination compute still requires acceptance',
    };
  }
  if (!selection.selected && selection.transfer) return {
    state: transfer?.started === false ? 'rejected' : 'proposed',
    action: (transfer?.started === false ? 'Move rejected → ' : 'Move proposed → ') + place(selection.transfer.destination),
    reason: transfer?.started === false ? plainReason(transfer.explanation)
      : 'Awaiting executor acceptance; future capacity is not reserved',
  };
  if (selection.selected && !result.accepted) return {
    state: 'rejected', action: 'Allocation rejected · ' + city,
    reason: 'The executor rejected this slot; no rejection reason was recorded',
  };
  if (selection.selected && result.accepted) {
    const accepted = selection.allocation.allocatedGpus + ' GPU' + (selection.allocation.allocatedGpus === 1 ? '' : 's')
      + ' accepted at ' + postedPrice(selection.allocation.postedUsdPerGpuHour) + '/GPU·h';
    return {
      state: 'accepted',
      action: movement?.move === false ? 'Stay · ' + city : '→ ' + city,
      reason: movement?.move === false
        ? 'Compared with ' + place(movement.destinationLocationId) + ': ' + plainReason(movement.reason)
        : accepted,
    };
  }
  return { state: 'waiting', action: 'Wait · ' + city, reason: plainReason(selection.explanation) };
}

export function FleetDecision({ progress, jobId, onInspect }: Props) {
  const record = latestDecision(progress, jobId);
  if (!record) return jobId ? <button type="button" className="fleet-decision" data-decision="pending"
    onClick={() => onInspect(jobId)} aria-label={'Inspect decision for ' + jobId}>
    <span className="fleet-decision-heading"><strong>{jobId} · No decision yet</strong><span aria-hidden="true">↗</span></span>
    <span className="fleet-decision-reason">The scheduler has not recorded a decision for this job.</span>
  </button> : null;
  const { result, hour } = record;
  const view = describe(progress, record);
  const isPast = progress.phase !== 'routed' || hour !== progress.hour;
  const original = [
    'Model hour ' + hour + '. Compute accepted: ' + result.accepted + '.',
    result.selection.explanation,
    result.selection.selected ? result.selection.allocation.allocatedGpus + ' GPUs selected.' : undefined,
    result.selection.movement ? 'Compared destination: ' + result.selection.movement.destinationLocationId + '. ' + result.selection.movement.reason : undefined,
    result.transfer?.explanation,
  ].filter(Boolean).join(' ');
  return <button type="button" className="fleet-decision" data-decision={view.state} data-job-id={result.jobId}
    title={original} onClick={() => onInspect(result.jobId)} aria-label={'Inspect decision for ' + result.jobId + ': ' + view.action + '. ' + view.reason}>
    <span className="fleet-decision-heading">
      <span className="fleet-decision-label">{isPast ? 'Last decision' : 'Decision'} · h{hour}</span>
      <strong>{result.jobId} {view.action}</strong>
      <span className="fleet-decision-open" aria-hidden="true">↗</span>
    </span>
    <span className="fleet-decision-reason">{view.reason}</span>
  </button>;
}
