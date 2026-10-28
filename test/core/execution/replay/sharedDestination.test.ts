import { expect, test } from 'vitest';
import { runPairedReplay } from '../../../../src/core/execution/replay/runPairedReplay.js';
import { defaultCapacityPlanningPolicy } from '../../../../src/core/energy/planning/CapacityPlan.types.js';
import { threeHourScenario } from './fixture.js';

/** Two 1 GPU-hour jobs share a two-hour deadline and a one-hour transfer. */
function competingForCleanCapacity() {
  const scenario = threeHourScenario();
  scenario.hours = 2;
  scenario.carbonPriceUsdPerTonne = 0;
  scenario.planning = { ...defaultCapacityPlanningPolicy };
  scenario.routing = { policy: 'fleet', movePolicy: 'carbon-benefit', transfer: {
    bandwidthGBPerHour: 1, kWhPerGB: .01, jobChargeUsdPerGB: .001,
    carbonGPerKWh: 400, electricityUsdPerMWh: 50,
    accountingBasis: scenario.sites[0].configuration.accountingBasis,
  } };
  scenario.sites.push(structuredClone(scenario.sites[1]));
  scenario.sites[2].configuration.locationId = 'C';
  scenario.sites.forEach((site, index) => {
    // A can run both jobs. B has one entirely solar GPU; C has one 90%-solar GPU.
    site.configuration.compute = { capGpus: index === 0 ? 2 : 1, kWPerGpu: 1 };
    site.forecast = site.forecast.slice(0, 2);
    site.observations = site.observations.slice(0, 2);
    for (const input of [...site.forecast, ...site.observations]) {
      input.supply = { solarKW: [0, 1, .9][index], fixedLoadKW: 0, gridImportLimitKW: 2, protectedKWh: 0 };
    }
  });
  Object.assign(scenario.jobs[0], { id: 'first', workGpuH: 1, remainingGpuH: 1, maxGpus: 1,
    dataGB: .1, allowedLocations: ['A', 'B', 'C'],
    window: { startAt: scenario.startAt, endAt: '2026-10-28T20:00:00Z' } });
  scenario.jobs.push({ ...structuredClone(scenario.jobs[0]), id: 'second' });
  return scenario;
}

test('two jobs use separate approved clean destinations instead of spending the same arrival capacity twice', async () => {
  const result = await runPairedReplay(competingForCleanCapacity());

  expect(result.selected.plans![0].deadlines.map(job => ({ job: job.jobId, site: job.locationId, status: job.status })))
    .toEqual([{ job: 'first', site: 'B', status: 'covered' }, { job: 'second', site: 'C', status: 'covered' }]);
  expect(result.selected.run.transfers.map(move => [move.jobId, move.toLocation]))
    .toEqual([['first', 'B'], ['second', 'C']]);
  expect(result.selected.finalJobs.map(job => [job.id, job.state, job.remainingGpuH]))
    .toEqual([['first', 'done', 0], ['second', 'done', 0]]);
  expect(result.selected.run.ticks[1].executions.map(work => [work.jobId, work.locationId, work.completedGpuH]))
    .toEqual([['first', 'B', 1], ['second', 'C', 1]]);
  expect(result.selected.impact.carbonKg).toBeCloseTo(.0408, 8);
  expect(result.selected.run.ticks.every(tick => tick.feasible)).toBe(true);
});

test('a shared-plan shortfall does not authorize another transfer into an already assigned arrival slot', async () => {
  const scenario = competingForCleanCapacity();
  scenario.sites = scenario.sites.slice(0, 2);
  for (const job of scenario.jobs) job.allowedLocations = ['A', 'B'];
  for (const input of [...scenario.sites[0].forecast, ...scenario.sites[0].observations]) input.supply!.gridImportLimitKW = 0;
  const result = await runPairedReplay(scenario);

  expect(result.selected.plans![0].deadlines.map(job => job.status)).toEqual(['covered', 'shortfall']);
  expect(result.selected.run.transfers.map(move => [move.jobId, move.toLocation])).toEqual([['first', 'B']]);
  expect(result.selected.finalJobs.map(job => [job.id, job.currentLocation, job.state, job.remainingGpuH]))
    .toEqual([['first', 'B', 'done', 0], ['second', 'A', 'missed', 1]]);
  expect(result.selected.run.ticks.flatMap(tick => tick.executions).reduce((sum, work) => sum + work.completedGpuH, 0)).toBe(1);
});
