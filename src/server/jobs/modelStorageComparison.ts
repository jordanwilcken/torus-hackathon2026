import type { StorageModel } from '../../data/LocalRun.type.ts';

export function modelStorageComparison(input: {
  computeKWh: number; roundTripEfficiency: number; wholesaleUsdPerMWh: number | null;
}): StorageModel {
  const { computeKWh, roundTripEfficiency, wholesaleUsdPerMWh } = input;
  if (!Number.isFinite(computeKWh) || computeKWh < 0 || !Number.isFinite(roundTripEfficiency) ||
    roundTripEfficiency <= 0 || roundTripEfficiency > 1 ||
    (wholesaleUsdPerMWh !== null && !Number.isFinite(wholesaleUsdPerMWh))) {
    throw new RangeError('Storage model requires nonnegative finite compute energy, efficiency in (0, 1], and a finite signed price or null');
  }
  const baselineGridKWh = computeKWh;
  const storageGridKWh = computeKWh / roundTripEfficiency;
  const baselineReferenceUsd = wholesaleUsdPerMWh === null ? null : (baselineGridKWh / 1000) * wholesaleUsdPerMWh;
  const storageReferenceUsd = wholesaleUsdPerMWh === null ? null : (storageGridKWh / 1000) * wholesaleUsdPerMWh;
  const differenceUsd = baselineReferenceUsd === null || storageReferenceUsd === null ? null : baselineReferenceUsd - storageReferenceUsd;
  if ([storageGridKWh, baselineReferenceUsd, storageReferenceUsd, differenceUsd].some(value => value !== null && !Number.isFinite(value))) {
    throw new RangeError('Storage model inputs overflow finite energy or price accounting');
  }
  return {
    modeled: true, label: 'Hypothetical storage-cycle comparison',
    assumptions: {
      energy: 'Equal assumed compute energy in both cases; not measured local energy and not evidence of execution in Utah.',
      storage: 'Direct grid supply leaves the battery idle. The storage case charges and discharges, restoring the same initial and ending inventory at the stated round-trip efficiency. This changes dispatch and does not establish a same-dispatch routing comparison; battery capacity and power are assumed sufficient.',
      carbon: 'Carbon intensity and measured emissions are unknown; no carbon saving is asserted.',
      market: 'The same wholesale reference price applies to charging and direct grid supply; no future price is predicted. Baseline minus storage is a signed model difference, not an actual electricity bill or measured saving; tariffs, demand charges, and degradation are excluded.',
    },
    computeKWh, roundTripEfficiency, baselineGridKWh, storageGridKWh,
    baselineReferenceUsd, storageReferenceUsd, differenceUsd, carbonKg: null,
  };
}
