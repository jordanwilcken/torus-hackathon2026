import { expect, test } from 'vitest';
import type { Job } from '../../../../src/core/jobs/Job.type.js';
import {
  classifyJob, DEFAULT_WORKLOAD_SETTINGS, generateWorkload, slackHours, type WorkloadSettings,
} from '../../../../src/core/execution/simulation/workload.js';

const HOUR = 3_600_000;
const startAt = '2026-10-26T00:00:00Z';
const week = 168;

const settings = (overrides: Partial<WorkloadSettings> = {}): WorkloadSettings =>
  ({ ...DEFAULT_WORKLOAD_SETTINGS, ...overrides });

const jobWith = (workGpuH: number, maxGpus: number, windowHours: number): Job => ({
  id: 'hand-built', workloadRef: 'hand-built', computeProfile: 'test', allowedLocations: ['A'],
  homeLocation: 'A', currentLocation: 'A', readyAt: startAt,
  window: { startAt, endAt: new Date(Date.parse(startAt) + windowHours * HOUR).toISOString() },
  workGpuH, remainingGpuH: workGpuH, maxGpus, dataGB: 0, state: 'queued',
});

const hourOf = (instant: string) => (Date.parse(instant) - Date.parse(startAt)) / HOUR;

test('the same seed, window and settings generate identical jobs; another seed does not', () => {
  const first = generateWorkload(7, startAt, week, settings({ jobCount: 40 }));
  const again = generateWorkload(7, startAt, week, settings({ jobCount: 40 }));
  const otherSeed = generateWorkload(8, startAt, week, settings({ jobCount: 40 }));

  expect(first).toHaveLength(40);
  expect(again).toEqual(first);
  expect(otherSeed.map(job => [job.readyAt, job.workGpuH])).not.toEqual(first.map(job => [job.readyAt, job.workGpuH]));
});

test('generated jobs arrive on the hour inside the horizon and can finish before it ends', () => {
  const jobs = generateWorkload(3, startAt, week, settings({ jobCount: 300 }));
  const ids = jobs.map(job => job.id);

  expect(new Set(ids).size).toBe(300);
  expect(ids[0]).toBe('job-0001');
  for (const [index, job] of jobs.entries()) {
    const arrival = hourOf(job.readyAt);
    expect(job.window.startAt).toBe(job.readyAt);
    expect(Number.isInteger(arrival) && arrival >= 0 && arrival < week).toBe(true);
    expect(hourOf(job.window.endAt)).toBeLessThanOrEqual(week);
    expect(slackHours(job)).toBeGreaterThanOrEqual(0);
    expect(job.remainingGpuH).toBe(job.workGpuH);
    expect(job.state).toBe('queued');
    expect(job.allowedLocations).toContain(job.homeLocation);
    expect(job.currentLocation).toBe(job.homeLocation);
    if (index > 0) expect(arrival).toBeGreaterThanOrEqual(hourOf(jobs[index - 1].readyAt));
  }
});

test('slack is window hours minus whole hours at maxGpus; at most one hour of slack is urgent', () => {
  expect(slackHours(jobWith(16, 8, 2))).toBe(0);
  expect(classifyJob(jobWith(16, 8, 2))).toBe('urgent');
  expect(slackHours(jobWith(16, 8, 3))).toBe(1);
  expect(classifyJob(jobWith(16, 8, 3))).toBe('urgent');
  expect(slackHours(jobWith(16, 8, 4))).toBe(2);
  expect(classifyJob(jobWith(16, 8, 4))).toBe('flexible');
  expect(slackHours(jobWith(17, 8, 4))).toBe(1);
  expect(classifyJob(jobWith(17, 8, 4))).toBe('urgent');
});

test('about 30% of jobs are urgent, and each class gets slack from its own configured range', () => {
  const jobs = generateWorkload(11, startAt, week * 2, settings({ jobCount: 2000 }));
  const urgent = jobs.filter(job => classifyJob(job) === 'urgent');
  const flexible = jobs.filter(job => classifyJob(job) === 'flexible');

  expect(urgent.length / jobs.length).toBeGreaterThan(0.27);
  expect(urgent.length / jobs.length).toBeLessThan(0.33);
  expect(new Set(urgent.map(slackHours))).toEqual(new Set([0, 1]));
  expect(Math.min(...flexible.map(slackHours))).toBe(2);
  expect(Math.max(...flexible.map(slackHours))).toBe(24);
});

test('job sizes are heavy-tailed: the largest tenth of jobs carries much of the work', () => {
  const sizes = generateWorkload(5, startAt, week * 2, settings({ jobCount: 2000 }))
    .map(job => job.workGpuH).sort((a, b) => a - b);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const largestTenth = sizes.slice(-200).reduce((sum, size) => sum + size, 0);
  const median = sizes[1000];

  expect(sizes[0]).toBeGreaterThanOrEqual(1);
  expect(sizes.at(-1)).toBeLessThanOrEqual(256);
  expect(largestTenth / total).toBeGreaterThan(0.4);
  expect(total / sizes.length).toBeGreaterThan(2 * median);
});

test('arrivals follow the configured daily peak rather than spreading evenly', () => {
  const jobs = generateWorkload(9, startAt, week, settings({ jobCount: 2000, arrivalPeakHourUtc: 18, diurnalAmplitude: 0.8 }));
  const hourOfDay = (job: Job) => new Date(job.readyAt).getUTCHours();
  const near = (centre: number) => jobs.filter(job => {
    const distance = Math.abs(hourOfDay(job) - centre);
    return Math.min(distance, 24 - distance) <= 3;
  }).length;

  expect(near(18)).toBeGreaterThan(2.5 * near(6));
});

test('settings that cannot fit the largest job inside the horizon are rejected', () => {
  expect(() => generateWorkload(1, startAt, 24, settings())).toThrow(RangeError);
  expect(() => generateWorkload(1, startAt, week, settings({ urgentShare: 1.2 }))).toThrow(RangeError);
  expect(() => generateWorkload(1, '2026-10-26T00:30:00Z', week, settings())).toThrow(RangeError);
});
