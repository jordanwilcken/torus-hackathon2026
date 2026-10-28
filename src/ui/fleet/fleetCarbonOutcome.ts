import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import type { ReplayArm } from '../../core/execution/replay/Replay.types';
import { compareReplay } from '../../core/execution/replay/compareReplay';
import { summarizeFleet } from './summarizeFleet';

const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Present the two arms' existing receipts. This does not allocate carbon to jobs or certify savings. */
export function fleetCarbonOutcome(progress: ReplayProgress, summary = summarizeFleet(progress)) {
  // During a routed callback baseline has settled its next tick but selected has not.
  // Compare only the paired completed hours, not two different observation windows.
  const through = Date.parse(progress.scenario.startAt) + progress.hour * 3_600_000;
  const completed = (arm: ReplayArm): ReplayArm => progress.done ? arm : {
    ...arm, run: { ...arm.run, ticks: arm.run.ticks.slice(0, progress.hour),
      transfers: arm.run.transfers.filter(receipt => Date.parse(receipt.window.startAt) < through) },
  };
  const baseline = summarizeFleet({ ...progress, selected: completed(progress.baseline), done: false }).carbon;
  const selected = summarizeFleet({ ...progress, selected: completed(progress.selected), done: false }).carbon;
  const totals = {
    baselineKg: baseline.kg, selectedKg: selected.kg,
    baselineLabel: baseline.kg === null ? baseline.status === 'pending' ? 'Pending' : 'Unknown' : number.format(baseline.kg) + ' kg',
    selectedLabel: selected.kg === null ? selected.status === 'pending' ? 'Pending' : 'Unknown' : number.format(selected.kg) + ' kg',
  };
  if (progress.done) {
    const reduction = summary.comparison.carbonReductionKg;
    if (summary.comparison.status !== 'comparable' || reduction === null) {
      const reason = compareReplay(progress.scenario, progress.baseline, progress.selected).comparison.carbon.unavailableReason;
      return { ...totals, status: 'unavailable' as const, tone: 'neutral' as const, reductionKg: null, percent: null,
        headline: 'Final comparison unavailable',
        detail: reason ?? 'Equal completed work, compatible evidence and matching storage are required.' };
    }
    const direction = reduction > 0 ? 'less' : 'more';
    return { ...totals, status: 'final' as const,
      tone: reduction > 0 ? 'lower' as const : reduction < 0 ? 'higher' as const : 'neutral' as const,
      reductionKg: reduction,
      percent: baseline.kg !== null && baseline.kg > 0 ? Math.round(Math.abs(reduction) / baseline.kg * 100) : null,
      headline: reduction === 0 ? 'No carbon difference' : number.format(Math.abs(reduction)) + ' kg ' + direction + ' carbon',
      detail: 'Final modeled comparison · equal work and storage' };
  }
  if (progress.hour < 1 || baseline.status === 'pending' || selected.status === 'pending') {
    return { ...totals, status: 'pending' as const, tone: 'neutral' as const, reductionKg: null, percent: null,
      headline: 'Carbon outcome pending', detail: 'Waiting for the first completed model hour.' };
  }
  if (baseline.kg === null || selected.kg === null) {
    return { ...totals, status: 'unknown' as const, tone: 'neutral' as const, reductionKg: null, percent: null,
      headline: 'Carbon comparison unknown', detail: 'One or more model receipts have no carbon value.' };
  }
  const reduction = baseline.kg - selected.kg;
  return { ...totals, status: 'provisional' as const,
    tone: reduction > 0 ? 'lower' as const : reduction < 0 ? 'higher' as const : 'neutral' as const,
    reductionKg: reduction, percent: null,
    headline: reduction === 0 ? 'No carbon difference so far'
      : number.format(Math.abs(reduction)) + ' kg ' + (reduction > 0 ? 'lower' : 'higher') + ' so far',
    detail: 'Provisional · final savings require equal work and storage' };
}
