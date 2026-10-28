import { expect, test } from 'vitest';
import { dataCenters, originForJob } from '../../../src/data/dataCenters';

test('synthetic work arrivals cycle through documented locations with explicit model labels', () => {
  expect(['work-01', 'work-02', 'work-03', 'work-04'].map(id => originForJob(id).id)).toEqual([
    'meta-eagle-mountain', 'google-the-dalles', 'google-loudoun', 'meta-eagle-mountain',
  ]);
  for (const jobId of ['work-01', 'work-02', 'work-03']) {
    expect(originForJob(jobId)).toMatchObject({
      jobId, simulated: true, kind: 'modeled-job-origin', locationAccuracy: 'city reference',
      label: 'Simulated job source; no facility workload connection',
    });
  }
});

test('a repeated inspection keeps the origin without allowing a returned value to change the catalog', () => {
  const initial = originForJob('training-a');
  const inspected = originForJob('training-a');
  inspected.name = 'Changed display';
  originForJob('work-02');
  expect(originForJob('training-a')).toEqual(initial);
  expect(dataCenters.some(center => center.name === 'Changed display')).toBe(false);
  expect(dataCenters.map(center => new URL(center.sourceUrl).hostname)).toEqual([
    'datacenters.atmeta.com', 'www.datacenters.google', 'www.datacenters.google',
  ]);
});
