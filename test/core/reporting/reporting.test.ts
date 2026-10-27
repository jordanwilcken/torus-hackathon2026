import { test } from "../../dsl/torus.fixture.js";


test("executed work captures otherwise-curtailed solar with the same ending battery inventory", async ({ torus }) => {
  const job = await torus.jobForHours("training", 1, 1, 1, 1);
  await torus.jobPlacement(job, "A", ["A", "B"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 2, 2);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.siteForCurrentHour("B", 1, 2, 0, 2, 2);
  await torus.siteStorage("B", 1, 0, 0, 1, 1, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.modeledCarbonPriceUsdPerTonne(100);
  await torus.siteCarbonForecast("A", 400, "simulated-grid-carbon-v1");
  await torus.siteCarbonForecast("B", 400, "simulated-grid-carbon-v1");
  await torus.transferAssumptions(0, 0, 0);
  await torus.sameAverageOperationalCO2Basis();
  await torus.homeSiteFifoBaselineWithSameAssetsAndDispatch();
  await torus.sitePostedPrice("A", 0.09);
  await torus.sitePostedPrice("B", 0);
  await torus.simulateBothPolicies(job, 1);
  await torus.readImpactReport(job);
  await torus.expectSelectedSite("B");
  await torus.expectAllocationCarbonForecast("B", 400, "simulated-grid-carbon-v1");
  await torus.expectCompletedWork("baseline", job, 1, 1);
  await torus.expectCompletedWork("selected", job, 1, 1);
  await torus.expectSiteEnergy("baseline", "A", 1, 1, 0);
  await torus.expectSiteEnergy("baseline", "B", 0, 0, 1);
  await torus.expectSiteEnergy("selected", "A", 0, 0, 0);
  await torus.expectSiteEnergy("selected", "B", 0, 1, 1);
  await torus.expectCurtailedSolar("baseline", "B", 1);
  await torus.expectCurtailedSolar("selected", "B", 0);
  await torus.expectEstimatedCarbon(0.4, 0, 0.4);
  await torus.expectEstimatedCosts(0.09, 0, 0.05, 0);
});


test("a lower carbon total for unfinished work is not a comparable reduction", async ({ torus }) => {
  const job = await torus.jobForHours("training", 2, 1, 2, 1);
  await torus.sameAverageOperationalCO2Basis();
  await torus.reportingHorizon("2026-10-27T12:00:00Z", "2026-10-27T14:00:00Z");
  await torus.reportingInventory("baseline", "A", 0, 0);
  await torus.reportingInventory("selected", "A", 0, 0);
  await torus.completedWorkEvidence("baseline", job, 2);
  await torus.completedWorkEvidence("selected", job, 1);
  await torus.carbonEvidence("baseline", job, 0.8);
  await torus.carbonEvidence("selected", job, 0.4);
  await torus.costEvidence("baseline", job, 0.18, 0.10);
  await torus.costEvidence("selected", job, 0.09, 0.05);
  await torus.readImpactReport(job);
  await torus.expectNotComparable();
});


test("a report cannot derive a reduction from unavailable selected carbon evidence", async ({ torus }) => {
  const job = await torus.jobForHours("training", 1, 1, 1, 1);
  await torus.sameAverageOperationalCO2Basis();
  await torus.reportingHorizon("2026-10-27T12:00:00Z", "2026-10-27T13:00:00Z");
  await torus.reportingInventory("baseline", "A", 0, 0);
  await torus.reportingInventory("selected", "A", 0, 0);
  await torus.completedWorkEvidence("baseline", job, 1);
  await torus.completedWorkEvidence("selected", job, 1);
  await torus.carbonEvidence("baseline", job, 0.4);
  await torus.unavailableCarbonEvidence("selected", job);
  await torus.readImpactReport(job);
  await torus.expectSelectedCarbonUnknown();
});

// Additional fairness guard: it affects all-tests-green, not the 100 rubric points.
test("lower carbon and cost from draining stored energy are not a comparable reduction", async ({ torus }) => {
  const job = await torus.jobForHours("training", 1, 1, 1, 1);
  await torus.sameAverageOperationalCO2Basis();
  await torus.reportingHorizon("2026-10-27T12:00:00Z", "2026-10-27T13:00:00Z");
  await torus.reportingInventory("baseline", "A", 1, 1);
  await torus.reportingInventory("selected", "A", 1, 0);
  await torus.completedWorkEvidence("baseline", job, 1);
  await torus.completedWorkEvidence("selected", job, 1);
  await torus.carbonEvidence("baseline", job, 0.4);
  await torus.carbonEvidence("selected", job, 0);
  await torus.costEvidence("baseline", job, 0.09, 0.05);
  await torus.costEvidence("selected", job, 0, 0);
  await torus.readImpactReport(job);
  await torus.expectNotComparable();
});
