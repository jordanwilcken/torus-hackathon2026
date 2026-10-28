import { expect, test } from 'vitest';
import { createPairedReplaySession } from '../../../../src/core/execution/replay/createPairedReplaySession.js';
import { runPairedReplay } from '../../../../src/core/execution/replay/runPairedReplay.js';
import { defaultCapacityPlanningPolicy } from '../../../../src/core/energy/planning/CapacityPlan.types.js';
import { threeHourScenario } from './fixture.js';

/** Real planner, whole-job move assessment, chooser, ledgers and executor on two 1 kW GPU sites. */
function choosingBetweenSites(homeSolar: number[], remoteSolar: number[], workGpuH: number, homeGridKW = 2) {
  const scenario = threeHourScenario();
  scenario.carbonPriceUsdPerTonne = 0;
  scenario.planning = { ...defaultCapacityPlanningPolicy };
  scenario.routing = { policy: 'fleet', movePolicy: 'carbon-benefit', transfer: {
    bandwidthGBPerHour: 1, kWhPerGB: .01, jobChargeUsdPerGB: .001,
    carbonGPerKWh: 400, electricityUsdPerMWh: 50,
    accountingBasis: scenario.sites[0].configuration.accountingBasis,
  } };
  Object.assign(scenario.jobs[0], {
    allowedLocations: ['A', 'B'], dataGB: .1, workGpuH, remainingGpuH: workGpuH,
  });
  scenario.sites.forEach((site, index) => {
    for (const inputs of [site.forecast, site.observations]) inputs.forEach((input, hour) => {
      input.supply!.solarKW = (index === 0 ? homeSolar : remoteSolar)[hour];
      input.supply!.fixedLoadKW = 0;
      input.supply!.gridImportLimitKW = index === 0 ? homeGridKW : 2;
    });
  });
  return scenario;
}

test('one cheap home hour cannot veto moving a larger whole job to cleaner cheaper available capacity', async () => {
  const result = await runPairedReplay(choosingBetweenSites([0, 0, 1], [1, 1, 1], 2));

  expect(result.selected.decisions[0].results[0]).toMatchObject({
    selection: { selected: false, transfer: { destination: 'B' }, movement: { move: true } },
    transfer: { started: true },
  });
  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'done', currentLocation: 'B', remainingGpuH: 0 });
  expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([0, 1, 1]);
  expect(result.selected.impact.carbonKg).toBeCloseTo(.0004, 8);
  expect(result.selected.run.ticks.every(tick => tick.feasible)).toBe(true);
});

test('a feasible remote route rescues a deadline when the home cannot finish without claiming carbon savings', async () => {
  const result = await runPairedReplay(choosingBetweenSites([0, 0, 0], [1, 1, 1], 1, 0));
  const departure = result.selected.decisions[0].results[0];

  expect(departure.transfer?.started).toBe(true);
  expect(departure.selection.movement).toMatchObject({ move: true, destinationLocationId: 'B', stay: { feasible: false } });
  expect(departure.selection.movement?.reason).toMatch(/deadline|cannot finish/i);
  expect(departure.selection.movement?.netCarbonReductionKg).toBeUndefined();
  expect(departure.selection.movement?.avoidedCarbonKg).toBeUndefined();
  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'done', currentLocation: 'B', remainingGpuH: 0 });
  expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([0, 1, 0]);
  expect(result.selected.impact.carbonKg).toBeCloseTo(.0004, 8);
});

test('waiting for enough cheaper home solar avoids an unnecessary whole-job transfer', async () => {
  const result = await runPairedReplay(choosingBetweenSites([0, 1, 1], [1, 1, 1], 1));

  expect(result.selected.run.transfers).toEqual([]);
  expect(result.selected.run.ticks.map(tick => tick.executions[0].completedGpuH)).toEqual([0, 1, 0]);
  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'done', currentLocation: 'A' });
  expect(result.selected.impact.carbonKg).toBe(0);
});

test('waiting reports a known rejected alternative instead of claiming its transfer assumptions are missing', async () => {
  const session = createPairedReplaySession(choosingBetweenSites([0, 1, 1], [1, 1, 1], 1));
  await session.step();
  const choice = session.read().selected.decisions[0].results[0].selection;

  expect(choice.selected).toBe(false);
  expect(choice.movement).toBeUndefined();
  expect(choice.explanation).toContain('Assessed alternative B was not chosen');
  expect(choice.explanation).toContain('transfer carbon');
  expect(choice.explanation).not.toContain('assumptions for B are unavailable');
});

test('an allocation at home has no unrelated remote movement attached to its actual choice', async () => {
  const session = createPairedReplaySession(choosingBetweenSites([1, 1, 1], [0, 0, 0], 1));
  await session.step();
  const choice = session.read().selected.decisions[0].results[0].selection;

  expect(choice).toMatchObject({ selected: true, allocation: { slot: { locationId: 'A' } } });
  expect(choice.movement).toBeUndefined();
});

test('deadline rescue still refuses a transfer whose arrival leaves insufficient execution time', async () => {
  const scenario = choosingBetweenSites([0, 0, 0], [1, 1, 1], 1, 0);
  scenario.jobs[0].window.endAt = scenario.sites[0].forecast[0].window.endAt;
  const result = await runPairedReplay(scenario);

  expect(result.selected.run.transfers).toEqual([]);
  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'missed', remainingGpuH: 1 });
  expect(result.selected.run.ticks.flatMap(tick => tick.executions).every(receipt => receipt.completedGpuH === 0)).toBe(true);
});

test('unknown transfer carbon does not prevent a physically feasible rescue or become invented savings', async () => {
  const scenario = choosingBetweenSites([0, 0, 0], [1, 1, 1], 1, 0);
  delete scenario.routing!.transfer.carbonGPerKWh;
  const result = await runPairedReplay(scenario);

  expect(result.selected.finalJobs[0]).toMatchObject({ state: 'done', currentLocation: 'B', remainingGpuH: 0 });
  expect(result.selected.run.transfers).toHaveLength(1);
  expect(result.selected.run.transfers[0].carbonKg).toBeUndefined();
  expect(result.selected.decisions[0].results[0].selection.movement).toMatchObject({ move: true, transferCarbonKg: null });
  expect(result.selected.decisions[0].results[0].selection.movement?.netCarbonReductionKg).toBeUndefined();
  expect(result.selected.impact.carbonKg).toBeNull();
  expect(result.reductions.carbonKg).toBeNull();
});
