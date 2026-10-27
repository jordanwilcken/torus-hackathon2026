import { test } from "../../dsl/torus.fixture.js";

import { expect } from "vitest";

import { expectData, comparisonEqual, finiteNumber } from "../../dsl/comparison.js";


/* @expec-test "1d737627-96c6-4d42-98da-94a79682df2c" */
test("the live map does not recommend a location from stale evidence", async ({ torus }) => {
  await torus.currentTimeIs("2026-10-27T12:06:00Z");
  const job = await torus.jobForHours("training", 1, 1, 1, 1, 10);
  await torus.jobPlacement(job, "A", ["A", "B"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 2, 2);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.siteForCurrentHour("B", 1, 0, 0, 2, 2);
  await torus.siteStorage("B", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(0, 0, 0);
  await torus.siteObservedAt("A", "2026-10-27T12:00:00Z");
  await torus.siteObservedAt("B", "2026-10-27T12:05:00Z");
  await torus.maximumEvidenceAgeIs(5);
  await torus.findWhereToRunNow(job);
  await torus.expectStaleSiteNotRecommended("A");
  await torus.expectCurrentSiteRecommended("B");
});
