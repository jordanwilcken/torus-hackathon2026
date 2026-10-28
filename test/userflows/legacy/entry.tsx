// Test-only composition preserving the legacy fixed-data regression scenarios.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StarterFlow } from '../../../src/ui/StarterFlow';
import { JobStream } from '../../../src/core/jobs/jobStream';
import { getFakeJob } from '../../fixtures/legacy/jobs/getFakeJob';
import { routeFakeJob } from '../../fixtures/legacy/scheduling/fakeRouter';
import { createFakeEnergyMap, getFakeEnergyMap } from '../../fixtures/legacy/energy/fakeEnergyMap';
import { getEnergyMap } from '../../../src/core/energy/getEnergyMap';
import staleInputs from '../../fixtures/legacy/energy/stale-sites.json';
import recordedInputs from '../../fixtures/legacy/reporting/execution.json';
import type { Job } from '../../../src/core/jobs/Job.type';
import type { ExecutionRun } from '../../../src/core/reporting/ExecutionEvidence.type';
import { summarizeExecution } from '../../../src/core/reporting/impact/summarizeExecution';
import { LiveGridInputs } from '../../../src/ui/energy/LiveGridInputs';
import { createPublicGridClient } from '../../../src/data/createPublicGridClient';
import { LocalExecution } from '../../../src/ui/jobs/LocalExecution';
import { JobSubmission } from '../../../src/ui/jobs/JobSubmission';
import { TorusDriver } from '../../driver/torus';
import '../../../src/style.css';
import '../../../src/ui/DemoApplication.css';

const publicGrid = createPublicGridClient();
const stream = new JobStream(routeFakeJob);
const scenario = new URLSearchParams(location.search).get('scenario');
const recorded = scenario === 'recorded-comparison';
const preview = (scenario === 'stale-site' ? staleInputs.job : recorded ? recordedInputs.job : getFakeJob()) as Job;
const staleMap = createFakeEnergyMap(staleInputs as Parameters<typeof createFakeEnergyMap>[0], {});
const queryEnergy = scenario === 'stale-site'
  ? (query: Parameters<typeof getEnergyMap>[0]) => getEnergyMap(query, staleMap)
  : getFakeEnergyMap;
let jobNumber = 0;
const jobSource = {
  preview,
  label: 'Fake job',
  next: () => ({ ...structuredClone(preview), id: ++jobNumber === 1 ? preview.id : preview.id + '-' + jobNumber }),
};

if (recorded) {
  void stream.submit(jobSource.next()).then(() => {
    stream.observe(summarizeExecution(recordedInputs.baseline as ExecutionRun));
    stream.observe(summarizeExecution(recordedInputs.selected as ExecutionRun));
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    {scenario === 'curtailed-solar' ? <CurtailedSolarFlow /> : <main>
      <header className="demo-heading">
        <div><h1>Sunchaser</h1><p>Compute follows energy.</p></div>
        <p className="demo-scope">Public grid inputs and real CPU output, alongside a modeled comparison of when to run GPU work.</p>
      </header>
      <a href="/">Open the working demo</a>
      <LiveGridInputs feeds={publicGrid} />
      <LocalExecution />
      <StarterFlow stream={stream} jobSource={jobSource} queryEnergy={queryEnergy}
        previewLabel={recorded ? 'Supplied simulation records — this application has not executed the work.' : undefined}
        reportSource={{ fake: true, label: recorded ? recordedInputs.label : 'Observed Fake job flow — no work has executed.' }} />
    </main>}
  </StrictMode>,
);


/** Test composition: explicit synthetic inputs, real production UI, pricing, routing, execution and reporting. */
function CurtailedSolarFlow() {
  const initial: Job = {
    id: "training", workloadRef: "Training batch", computeProfile: "test-1-kWh-per-GPUh",
    window: { startAt: "2026-10-27T12:00:00Z", endAt: "2026-10-27T13:00:00Z" },
    allowedLocations: ["A", "B"], homeLocation: "A", currentLocation: "A",
    readyAt: "2026-10-27T12:00:00Z", workGpuH: 1, remainingGpuH: 1, maxGpus: 1, dataGB: 0, state: "queued",
  };
  const [active, setActive] = useState<{
    driver: TorusDriver; stream: JobStream; job: Job; selectedSite: string | null;
    prices: Array<{ site: string; usdPerGpuHour: number }>;
  }>();
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");

  async function submit(job: Job) {
    const driver = new TorusDriver();
    await driver.jobForHours(job.id, job.workGpuH, job.maxGpus,
      (Date.parse(job.window.endAt) - Date.parse(job.window.startAt)) / 3_600_000, 1);
    await driver.siteForCurrentHour("A", 1, 0, 0, 2, 2);
    await driver.siteStorage("A", 0, 0, 0, 0, 0, 1, 1);
    await driver.siteForCurrentHour("B", 1, 2, 0, 2, 2);
    await driver.siteStorage("B", 1, 0, 0, 1, 1, 1, 1);
    await driver.currentGridTerms(400, 50);
    await driver.modeledCarbonPriceUsdPerTonne(100);
    await driver.siteCarbonForecast("A", 400, "declared-grid-carbon");
    await driver.siteCarbonForecast("B", 400, "declared-grid-carbon");
    await driver.transferAssumptions(0, 0, 0);
    await driver.sameAverageOperationalCO2Basis();
    await driver.homeSiteFifoBaselineWithSameAssetsAndDispatch();
    // No posted prices are injected: quoteSiteEnergy prices these declared energy inputs.
    const stream = new JobStream(async submitted => {
      await driver.routeCurrentSlot(submitted);
      return driver.outcome();
    });
    const outcome = await stream.submit(job);
    for (const observation of driver.observations()) stream.observe(observation);
    const map = driver.queryEnergy({ window: job.window, asOf: job.readyAt });
    const prices = [...map.sites.values()].flatMap(site => site.slots.flatMap(reading =>
      reading.snapshot.slot ? [{ site: site.id, usdPerGpuHour: reading.snapshot.slot.postedUsdPerGpuHour }] : []));
    setActive({ driver, stream, job, prices, selectedSite: outcome.selected ? outcome.allocation.slot.locationId : null });
    setFinished(false);
    setError("");
  }

  async function execute() {
    if (!active) return;
    try {
      await active.driver.executeComparison(active.job);
      for (const observation of active.driver.observations()) active.stream.observe(observation);
      setFinished(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }

  return <main>
    <h1>Curtailed solar comparison lab</h1>
    <p>Declared modeled GPU work. A has no solar or storage; B has 2 kWh solar and 1 kWh empty storage.
      Both policies use the same assets, a 400 gCO₂/kWh grid, $50/MWh electricity and $100/tonne modeled carbon price.</p>
    <JobSubmission initialJob={initial} locations={[{ id: "A", name: "Site A" }, { id: "B", name: "Site B" }]} onSubmit={submit} />
    {active && <>
      <ul aria-label="Posted prices">{active.prices.map(price => <li key={price.site}
        data-location-id={price.site} data-posted-price={price.usdPerGpuHour}>
        {price.site}: {"$"}{price.usdPerGpuHour.toFixed(2)} / GPU-hour
      </li>)}</ul>
      <p>Selected site: <output data-testid="selected-site">{active.selectedSite ?? "None"}</output></p>
      <button onClick={() => void execute()} disabled={finished}>Execute and compare</button>
      {error && <p role="alert">{error}</p>}
      <StarterFlow stream={active.stream}
        jobSource={{ preview: active.job, next: () => structuredClone(active.job), label: "declared job" }}
        queryEnergy={query => active.driver.queryEnergy(query)}
        reportSource={{ fake: false, label: "Modeled execution calculated by the production scheduler and executor." }} />
    </>}
  </main>;
}
