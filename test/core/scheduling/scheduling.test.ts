import { test } from "../../dsl/torus.fixture.js";

test("a site with only protected stored energy receives no allocation this hour", async ({ torus }) => {
  const job = await torus.jobForHours("training", 4, 1, 4, 1);
  await torus.jobPlacement(job, "A", ["A"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 0, 2);
  await torus.siteStorage("A", 6, 4, 4, 1, 1, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(0, 0, 0);
  await torus.sitePostedPrice("A", 0);
  await torus.routeCurrentSlot(job);
  await torus.expectNoSelection();
});

test("posted-price allocation uses only the GPUs remaining in the slot", async ({ torus }) => {
  const job = await torus.jobForHours("training", 8, 8, 8, 1);
  await torus.jobPlacement(job, "A", ["A"]);
  await torus.siteForCurrentHour("A", 8, 0, 0, 10, 10);
  await torus.siteUsedGpus("A", 7);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(0, 0, 0);
  await torus.sitePostedPrice("A", 1);
  await torus.routeCurrentSlot(job);
  await torus.expectSelectedSite("A");
  await torus.expectAllocationGpus(1);
  await torus.expectCompletedWork("selected", job, 0, 0);
});

test("urgency and a clean forecast cannot override a utility import commitment", async ({ torus }) => {
  const job = await torus.jobForHours("urgent training", 1, 1, 1, 1);
  await torus.jobPlacement(job, "A", ["A"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 2, 2);
  await torus.siteUtilityImportLimit("A", 0);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.siteCarbonForecast("A", 0, "simulated-clean-forecast");
  await torus.transferAssumptions(0, 0, 0);
  await torus.sitePostedPrice("A", 0);
  await torus.routeCurrentSlot(job);
  await torus.expectNoSelection();
  await torus.expectRemainingWork(job, 1);
});

test("a remote slot is rejected when transfer and work cannot meet the deadline", async ({ torus }) => {
  const job = await torus.jobForHours("remote training", 1, 1, 1, 1);
  await torus.jobPlacement(job, "A", ["B"]);
  await torus.siteForCurrentHour("B", 1, 1, 0, 2, 2);
  await torus.siteStorage("B", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.transferAssumptions(2, 0.1, 0.01);
  await torus.sitePostedPrice("B", 0);
  await torus.routeCurrentSlot(job);
  await torus.expectNoSelection();
  await torus.expectRemainingWork(job, 1);
});

// These are supplied current slot prices and forecast evidence. Routing does not execute work
// or prove price generation or realized emissions; execution/reporting have separate tests.
test("a job selects the lower-carbon eligible slot at its posted price", async ({ torus }) => {
  const job = await torus.jobForHours("training", 1, 1, 1, 1);
  await torus.jobPlacement(job, "A", ["A", "B"]);
  await torus.siteForCurrentHour("A", 1, 0, 0, 2, 2);
  await torus.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
  await torus.siteForCurrentHour("B", 1, 0, 0, 2, 2);
  await torus.siteStorage("B", 0, 0, 0, 0, 0, 1, 1);
  await torus.currentGridTerms(400, 50);
  await torus.modeledCarbonPriceUsdPerTonne(100);
  await torus.siteCarbonForecast("A", 400, "simulated-region-A-carbon");
  await torus.siteCarbonForecast("B", 100, "simulated-region-B-carbon");
  await torus.transferAssumptions(0, 0, 0);
  await torus.sitePostedPrice("A", 0.09);
  await torus.sitePostedPrice("B", 0.06);
  await torus.routeCurrentSlot(job);
  await torus.expectSelectedSite("B");
  await torus.expectAllocationGpus(1);
  await torus.expectSelectedPostedPrice(0.06);
  await torus.expectAllocationCarbonForecast("B", 100, "simulated-region-B-carbon");
  await torus.expectCompletedWork("selected", job, 0, 0);
  await torus.expectRemainingWork(job, 1);
});
