import { test } from "../../dsl/torus.fixture.js";

import { expect } from "vitest";

import { expectData, comparisonEqual, finiteNumber } from "../../dsl/comparison.js";


test("the executor accounts only for the remaining work in a partial final tick", async ({ torus }) => {
  const job = await torus.jobForHours("short batch", 0.25, 1, 1, 0.85, 10);
  await torus.jobPlacement(job, "A", ["A"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 2, 2);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(0, 0, 0);
  await torus.siteOfferPrice("A", 1);
  await torus.routeCurrentSlot(job);
  await torus.executeSelectedSlot(job);
  await torus.expectSelectedSite("A");
  await torus.expectCompletedWork("selected", job, 1, 0.25);
  await torus.expectRemainingWork(job, 0);
  await torus.expectSiteEnergy("selected", "A", 0.2125, 0.2125, 0);
  await torus.expectExecutionCharges(job, "A", 0.25, 0.010625);
});
