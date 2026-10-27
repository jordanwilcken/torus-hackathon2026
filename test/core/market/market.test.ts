import { test } from "../../dsl/torus.fixture.js";

import { expect } from "vitest";

import { expectData, comparisonEqual, finiteNumber } from "../../dsl/comparison.js";


/* @expec-test "59eac1f9-09fe-47be-80f0-232c2f93026f" */
test("a site with only protected stored energy makes no execution offer this hour", async ({ torus }) => {
  const job = await torus.jobForHours("training", 4, 1, 4, 1, 10);
  await torus.jobPlacement(job, "A", ["A"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 0, 2);
  await torus.siteStorage("A", 6, 4, 4, 1, 1, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(0, 0, 0);
  await torus.routeCurrentSlot(job);
  await torus.expectSiteOfferCount("A", 0);
  await torus.expectCapacityBidCount(job, 0);
  await torus.expectNoSelection();
});


/* @expec-test "90ba4ce9-d1fa-40ea-89fa-e103f5b910f0" */
test("a job declines an available site offer it cannot afford", async ({ torus }) => {
  const job = await torus.jobForHours("training", 1, 1, 1, 1, 0.5);
  await torus.jobPlacement(job, "A", ["A"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 2, 2);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(0, 0, 0);
  await torus.siteOfferPrice("A", 1);
  await torus.routeCurrentSlot(job);
  await torus.expectSiteOfferCount("A", 1);
  await torus.expectCapacityBidCount(job, 0);
  await torus.expectNoSelection();
});
