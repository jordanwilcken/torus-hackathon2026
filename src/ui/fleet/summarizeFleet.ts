import type { ReplayProgress } from '../../core/execution/replay/createPairedReplaySession';
import { compareReplay } from '../../core/execution/replay/compareReplay';

export type FleetSummaryInput = Pick<ReplayProgress, 'scenario' | 'selected' | 'baseline' | 'done'>;

/** A presentation of existing model receipts, with no new energy or carbon model. */
export function summarizeFleet(progress: FleetSummaryInput) {
  const { run } = progress.selected;
  const meters = run.ticks.flatMap(tick => tick.meters);
  const executions = run.ticks.flatMap(tick => tick.executions);
  const carbonReceipts = [...meters, ...run.transfers];
  const allCarbonKnown = carbonReceipts.every(receipt =>
    typeof receipt.carbonKg === 'number' && Number.isFinite(receipt.carbonKg) && receipt.carbonKg >= 0);
  const carbonTotal = allCarbonKnown ? carbonReceipts.reduce((sum, receipt) => sum + receipt.carbonKg!, 0) : null;
  const carbonKnown = carbonTotal !== null && Number.isFinite(carbonTotal);
  const inventory = new Map(run.sites.map(site => [
    site.locationId, { at: -Infinity, storedKWh: site.initialStoredKWh },
  ]));
  for (const meter of meters) {
    const prior = inventory.get(meter.locationId);
    const at = Date.parse(meter.window.endAt);
    if (prior && at >= prior.at) inventory.set(meter.locationId, { at, storedKWh: meter.endingStoredKWh });
  }
  const compared = progress.done ? compareReplay(progress.scenario, progress.baseline, progress.selected) : null;
  const comparable = compared?.comparison.comparison === 'comparable' && compared.reductions.carbonKg !== null;

  return {
    work: {
      completedGpuH: executions.reduce((sum, execution) => sum + execution.completedGpuH, 0),
      totalGpuH: progress.scenario.jobs.reduce((sum, job) => sum + job.workGpuH, 0),
    },
    energy: {
      hasReceipts: meters.length > 0,
      solarUsedKWh: meters.reduce((sum, meter) => sum + meter.solarKWh - meter.curtailedKWh, 0),
      gridImportKWh: meters.reduce((sum, meter) => sum + meter.gridImportKWh, 0),
    },
    storage: {
      storedKWh: [...inventory.values()].reduce((sum, site) => sum + site.storedKWh, 0),
      capacityKWh: progress.scenario.sites.reduce((sum, site) => sum + site.configuration.storage.limits.capacityKWh, 0),
    },
    carbon: {
      status: carbonReceipts.length === 0 ? 'pending' as const : carbonKnown ? 'known' as const : 'unknown' as const,
      kg: carbonReceipts.length > 0 && carbonKnown ? carbonTotal : null,
    },
    comparison: {
      status: !progress.done ? 'pending' as const : comparable ? 'comparable' as const : 'unavailable' as const,
      carbonReductionKg: comparable ? compared.reductions.carbonKg : null,
    },
  };
}
