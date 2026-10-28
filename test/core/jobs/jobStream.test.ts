import { expect, test, vi } from 'vitest';
import { JobStream } from '../../../src/core/jobs/jobStream.js';
import { getFakeJob } from '../../../src/core/jobs/fakes/getFakeJob.js';
import type { Job } from '../../../src/core/jobs/Job.type.js';
import type { JobOutcome } from '../../../src/core/scheduling/JobOutcome.type.js';
import type { JobObservations } from '../../../src/core/reporting/JobObservations.type.js';
import { createJobReport } from '../../../src/core/reporting/getJobReport.js';

const job = (id: string): Job => ({ ...getFakeJob(), id });

function selected(submitted: Job, locationId: string): JobOutcome {
  return {
    selected: true,
    allocation: {
      jobId: submitted.id, slot: { locationId, slotId: locationId + '-18' }, slotVersion: 'supplied-1',
      allocatedGpus: 1, kWhPerGpuHour: 1, requiredPowerKW: 1,
      energy: [{ window: submitted.window, estimatedKWh: 1 }], forecast: {},
      postedUsdPerGpuHour: 0.09, priceBasis: 'Supplied test offer',
    },
    explanation: 'Supplied selection; execution has not started.',
  };
}

test('publishes the submitted job while routing is pending, then its observed outcome', async () => {
  const submitted = job('training-a');
  const routing = Promise.withResolvers<JobOutcome>();
  const routeJob = vi.fn(async (_job: Job) => routing.promise);
  const stream = new JobStream(routeJob);
  const updates: JobObservations[][] = [];
  stream.subscribe(snapshot => updates.push(snapshot));

  expect(updates).toEqual([[]]);
  const pending = stream.submit(submitted);
  expect(updates.at(-1)).toEqual([{ jobId: submitted.id, submittedJob: submitted }]);
  expect(routeJob).toHaveBeenCalledWith(submitted);
  expect(routeJob.mock.calls[0]).toHaveLength(1);

  const outcome = selected(submitted, 'fake-utah-solar');
  routing.resolve(outcome);
  expect(await pending).toBe(outcome);
  expect(updates.at(-1)).toEqual([{
    jobId: submitted.id, submittedJob: submitted, routingOutcome: outcome,
  }]);
  const report = createJobReport(stream.read()[0]);
  expect(report.comparison).toBe('unavailable');
  expect(report.carbon.selectedCarbonKg).toBeUndefined();
  expect(report.cost.selectedModeledCostUsd).toBeUndefined();
});

test('keeps both reports attached to their jobs when routing finishes out of order', async () => {
  const first = job('training-a');
  const second = job('training-b');
  const firstRouting = Promise.withResolvers<JobOutcome>();
  const secondRouting = Promise.withResolvers<JobOutcome>();
  const stream = new JobStream(submitted => submitted.id === first.id ? firstRouting.promise : secondRouting.promise);

  const firstPending = stream.submit(first);
  const secondPending = stream.submit(second);
  const secondOutcome = selected(second, 'fake-utah-grid');
  secondRouting.resolve(secondOutcome);
  await secondPending;

  expect(stream.read()).toEqual([
    { jobId: first.id, submittedJob: first },
    { jobId: second.id, submittedJob: second, routingOutcome: secondOutcome },
  ]);
  const firstOutcome = selected(first, 'fake-utah-solar');
  firstRouting.resolve(firstOutcome);
  await firstPending;

  const reports = stream.read().map(observations => createJobReport(observations));
  expect(reports.map(report => [report.jobId, report.routingOutcome])).toEqual([
    [first.id, firstOutcome], [second.id, secondOutcome],
  ]);
});

test('a routing failure is recorded for that job while other jobs continue', async () => {
  const first = job('training-a');
  const second = job('training-b');
  const firstRouting = Promise.withResolvers<JobOutcome>();
  const secondRouting = Promise.withResolvers<JobOutcome>();
  const stream = new JobStream(submitted => submitted.id === first.id ? firstRouting.promise : secondRouting.promise);
  const firstPending = stream.submit(first);
  const secondPending = stream.submit(second);
  const failure = new Error('Site unavailable');
  const rejected = expect(firstPending).rejects.toBe(failure);

  firstRouting.reject(failure);
  await rejected;
  const secondOutcome = selected(second, 'fake-utah-solar');
  secondRouting.resolve(secondOutcome);
  expect(await secondPending).toBe(secondOutcome);

  expect(stream.read()).toEqual([
    { jobId: first.id, submittedJob: first, routingFailure: 'Site unavailable' },
    { jobId: second.id, submittedJob: second, routingOutcome: secondOutcome },
  ]);
});

test('rejects a duplicate job ID without rerouting or overwriting the existing job', async () => {
  const submitted = job('training-a');
  const routing = Promise.withResolvers<JobOutcome>();
  const routeJob = vi.fn(async (_job: Job) => routing.promise);
  const stream = new JobStream(routeJob);
  const pending = stream.submit(submitted);

  await expect(stream.submit({ ...submitted, workGpuH: 99 })).rejects.toThrow();
  expect(stream.read()).toEqual([{ jobId: submitted.id, submittedJob: submitted }]);
  expect(routeJob).toHaveBeenCalledTimes(1);

  const outcome = selected(submitted, 'fake-utah-solar');
  routing.resolve(outcome);
  await pending;
  await expect(stream.submit(submitted)).rejects.toThrow();
  expect(stream.read()[0].routingOutcome).toEqual(outcome);
  expect(routeJob).toHaveBeenCalledTimes(1);
});

test('caller and subscriber mutations cannot change the retained job observations', async () => {
  const submitted = job('training-a');
  const original = structuredClone(submitted);
  const outcome = selected(submitted, 'fake-utah-solar');
  const originalOutcome = structuredClone(outcome);
  const stream = new JobStream(async () => outcome);
  stream.subscribe(snapshot => {
    if (snapshot[0]?.submittedJob) snapshot[0].submittedJob.workGpuH = 100;
  });
  let received: JobObservations[] = [];
  stream.subscribe(snapshot => { received = snapshot; });

  await stream.submit(submitted);
  submitted.workGpuH = 200;
  outcome.explanation = 'Changed by caller';
  const returned = stream.read();
  returned[0].submittedJob!.allowedLocations.length = 0;

  expect(stream.read()).toEqual([{
    jobId: original.id, submittedJob: original, routingOutcome: originalOutcome,
  }]);
  expect(received[0].submittedJob).toEqual(original);
});

test('unsubscribing stops updates without interrupting the submitted job', async () => {
  const submitted = job('training-a');
  const routing = Promise.withResolvers<JobOutcome>();
  const stream = new JobStream(async () => routing.promise);
  const listener = vi.fn();
  const unsubscribe = stream.subscribe(listener);
  const pending = stream.submit(submitted);
  const updatesBeforeUnsubscribe = listener.mock.calls.length;

  unsubscribe();
  const outcome = selected(submitted, 'fake-utah-solar');
  routing.resolve(outcome);
  expect(await pending).toBe(outcome);

  expect(listener).toHaveBeenCalledTimes(updatesBeforeUnsubscribe);
  expect(stream.read()[0].routingOutcome).toEqual(outcome);
});

test('a failing subscriber cannot stop routing or updates to another subscriber', async () => {
  const submitted = job('training-a');
  const outcome = selected(submitted, 'fake-utah-solar');
  const stream = new JobStream(async () => outcome);
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    stream.subscribe(() => { throw new Error('View failed'); });
    let received: JobObservations[] = [];
    stream.subscribe(snapshot => { received = snapshot; });

    expect(await stream.submit(submitted)).toBe(outcome);
    expect(received[0].routingOutcome).toEqual(outcome);
    expect(stream.read()[0].routingFailure).toBeUndefined();
  } finally {
    logging.mockRestore();
  }
});
