import { expect, test } from 'vitest';
import { modelStorageComparison } from '../../../src/server/jobs/modelStorageComparison';

test('restoring the same storage inventory requires more grid energy and costs more at a positive reference price', () => {
  const result = modelStorageComparison({ computeKWh: 10, roundTripEfficiency: 0.8, wholesaleUsdPerMWh: 100 });
  expect(result).toMatchObject({ modeled: true, computeKWh: 10, roundTripEfficiency: 0.8, baselineGridKWh: 10, storageGridKWh: 12.5, baselineReferenceUsd: 1, storageReferenceUsd: 1.25, differenceUsd: -0.25, carbonKg: null });
  expect(result.label).toMatch(/hypothetical/i);
  expect(result.assumptions.energy).toMatch(/not measured/i);
  expect(result.assumptions.storage).toMatch(/same initial and ending inventory/i);
  expect(result.assumptions.storage).toMatch(/changes dispatch/i);
  expect(result.assumptions.market).toMatch(/same.*price/i);
  expect(result.assumptions.market).toMatch(/not.*bill/i);
});

test('negative wholesale reference prices preserve their sign without claiming measured savings', () => {
  expect(modelStorageComparison({ computeKWh: 10, roundTripEfficiency: 0.8, wholesaleUsdPerMWh: -100 }))
    .toMatchObject({ baselineReferenceUsd: -1, storageReferenceUsd: -1.25, differenceUsd: 0.25, carbonKg: null });
});

test('unknown price and carbon remain unknown rather than becoming zero', () => {
  const result = modelStorageComparison({ computeKWh: 10, roundTripEfficiency: 1, wholesaleUsdPerMWh: null });
  expect(result).toMatchObject({ baselineGridKWh: 10, storageGridKWh: 10, baselineReferenceUsd: null, storageReferenceUsd: null, differenceUsd: null, carbonKg: null });
});

test('perfect efficiency and zero assumed work have no invented loss or carbon measurements', () => {
  expect(modelStorageComparison({ computeKWh: 10, roundTripEfficiency: 1, wholesaleUsdPerMWh: 100 }).differenceUsd).toBe(0);
  expect(modelStorageComparison({ computeKWh: 0, roundTripEfficiency: 0.8, wholesaleUsdPerMWh: 100 }))
    .toMatchObject({ baselineGridKWh: 0, storageGridKWh: 0, differenceUsd: 0, carbonKg: null });
});

test.each([
  { computeKWh: -1, roundTripEfficiency: 0.8, wholesaleUsdPerMWh: 100 },
  { computeKWh: Number.NaN, roundTripEfficiency: 0.8, wholesaleUsdPerMWh: 100 },
  { computeKWh: 10, roundTripEfficiency: 0, wholesaleUsdPerMWh: 100 },
  { computeKWh: 10, roundTripEfficiency: 1.1, wholesaleUsdPerMWh: 100 },
  { computeKWh: 10, roundTripEfficiency: 0.8, wholesaleUsdPerMWh: Number.POSITIVE_INFINITY },
  { computeKWh: Number.MAX_VALUE, roundTripEfficiency: Number.MIN_VALUE, wholesaleUsdPerMWh: 100 },
])('invalid or overflowing model inputs fail explicitly: %j', input => {
  expect(() => modelStorageComparison(input)).toThrow(RangeError);
});
