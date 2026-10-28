import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import type { ReplayArm } from '../../core/execution/replay/Replay.types';
import { compareReplay } from '../../core/execution/replay/compareReplay';
import { summarizeFleet } from './summarizeFleet';

const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const carbonLabel = (kg: number | null, pending = false) => kg === null
  ? pending ? 'Pending' : 'Unknown' : number.format(kg) + ' kg';

/** Presentation tolerance only: raw signed differences and accounting guards remain unchanged. */
function difference(reduction: number, baseline: number | null, selected: number | null, final: boolean) {
  const roundingAllowance = Number.EPSILON * Math.max(1, Math.abs(baseline ?? 0), Math.abs(selected ?? 0)) * 4;
  const displayed = Math.abs(reduction) <= roundingAllowance ? 0 : reduction;
  const rawPercent = baseline !== null && baseline > 0 ? Math.abs(displayed) / baseline * 100 : null;
  const percent = rawPercent !== null && Number.isFinite(rawPercent) ? Math.round(rawPercent) : null;
  const direction = displayed > 0 ? final ? 'less' : 'lower' : final ? 'more' : 'higher';
  const suffix = final ? ' carbon' : ' so far';
  const kilograms = Math.abs(displayed) > 0 && Math.abs(displayed) < .005
    ? '<0.01' : number.format(Math.abs(displayed));
  const differenceLabel = displayed === 0
    ? reduction === 0 ? 'No carbon difference' : 'Carbon difference is below numerical precision'
    : kilograms + ' kg ' + direction + suffix;
  return {
    tone: displayed > 0 ? 'lower' as const : displayed < 0 ? 'higher' as const : 'neutral' as const,
    reductionKg: reduction, percent, differenceLabel,
    headline: displayed === 0 ? final ? 'No carbon difference' : 'No carbon difference yet'
      : percent !== null ? (percent === 0 ? '<1' : percent) + '% ' + direction + suffix : differenceLabel,
  };
}

/** Present the two arms' existing receipts. This does not allocate carbon to jobs or certify savings. */
export function fleetCarbonOutcome(progress: ReplayProgress, summary = summarizeFleet(progress)) {
  // During a routed callback baseline has settled its next tick but selected has not.
  // Compare only the paired completed hours, not two different observation windows.
  const through = Date.parse(progress.scenario.startAt) + progress.hour * 3_600_000;
  const completed = (arm: ReplayArm): ReplayArm => progress.done ? arm : {
    ...arm, run: { ...arm.run, ticks: arm.run.ticks.slice(0, progress.hour),
      transfers: arm.run.transfers.filter(receipt => Date.parse(receipt.window.startAt) < through) },
  };
  const before = summarizeFleet({ ...progress, selected: completed(progress.baseline), done: false });
  const after = summarizeFleet({ ...progress, selected: completed(progress.selected), done: false });
  const baseline = before.carbon, selected = after.carbon;
  const storedEnergy = (arm: ReplayArm, latest: number) => {
    const initial = arm.run.sites.map(site => site.initialStoredKWh);
    const start = initial.length > 0 && initial.every(value => Number.isFinite(value) && value >= 0)
      ? initial.reduce((sum, value) => sum + value, 0) : null;
    return {
      startKWh: start !== null && Number.isFinite(start) ? start : null,
      endingKWh: Number.isFinite(latest) && latest >= 0 ? latest : null,
    };
  };
  const totals = {
    baselineKg: baseline.kg, selectedKg: selected.kg,
    baselineLabel: carbonLabel(baseline.kg, baseline.status === 'pending'),
    selectedLabel: carbonLabel(selected.kg, selected.status === 'pending'),
    storage: {
      baseline: storedEnergy(progress.baseline, before.storage.storedKWh),
      selected: storedEnergy(progress.selected, after.storage.storedKWh),
    },
  };
  if (progress.done) {
    const reduction = summary.comparison.carbonReductionKg;
    const compared = compareReplay(progress.scenario, progress.baseline, progress.selected);
    if (summary.comparison.status !== 'comparable' || reduction === null) {
      return { ...totals, status: 'unavailable' as const, tone: 'neutral' as const, reductionKg: null, percent: null,
        differenceLabel: null, headline: 'Final comparison unavailable',
        detail: compared.comparison.carbon.unavailableReason ?? 'Equal completed work, compatible evidence and matching storage are required.' };
    }
    // The final percentage uses the same validated totals as the final reduction.
    const finalBaseline = compared.comparison.carbon.baselineCarbonKg ?? null;
    const finalSelected = compared.comparison.carbon.selectedCarbonKg ?? null;
    return { ...totals, baselineKg: finalBaseline, selectedKg: finalSelected,
      baselineLabel: carbonLabel(finalBaseline), selectedLabel: carbonLabel(finalSelected),
      status: 'final' as const, ...difference(reduction, finalBaseline, finalSelected, true),
      detail: 'Final modeled comparison · equal completed work and matching stored energy and carbon at every site' };
  }
  if (progress.hour < 1 || baseline.status === 'pending' || selected.status === 'pending') {
    return { ...totals, status: 'pending' as const, tone: 'neutral' as const, reductionKg: null, percent: null,
      differenceLabel: null, headline: 'Carbon outcome pending', detail: 'Waiting for the first completed model hour.' };
  }
  if (baseline.kg === null || selected.kg === null) {
    return { ...totals, status: 'unknown' as const, tone: 'neutral' as const, reductionKg: null, percent: null,
      differenceLabel: null, headline: 'Carbon comparison unknown', detail: 'One or more model receipts have no carbon value.' };
  }
  return { ...totals, status: 'provisional' as const,
    ...difference(baseline.kg - selected.kg, baseline.kg, selected.kg, false),
    detail: 'Provisional · final savings require equal work and matching stored energy and carbon at every site' };
}
