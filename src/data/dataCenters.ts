export type DataCenter = {
  id: string;
  name: string;
  operator: string;
  latitude: number;
  longitude: number;
  sourceUrl: string;
  locationAccuracy: 'city reference';
};

/** Operator pages confirm these public locations (checked 2026-10-28).
 * Coordinates are deliberately coarse display references, not published campus coordinates.
 * The Loudoun County marker uses Leesburg as its city reference.
 */
export const dataCenters: readonly Readonly<DataCenter>[] = Object.freeze([
  Object.freeze({
    id: 'meta-eagle-mountain', name: 'Meta Eagle Mountain, Utah', operator: 'Meta',
    latitude: 40.31, longitude: -112.01, locationAccuracy: 'city reference' as const,
    sourceUrl: 'https://datacenters.atmeta.com/2026/09/deepening-our-investment-in-eagle-mountain-utah/',
  }),
  Object.freeze({
    id: 'google-the-dalles', name: 'Google The Dalles, Oregon', operator: 'Google',
    latitude: 45.60, longitude: -121.18, locationAccuracy: 'city reference' as const,
    sourceUrl: 'https://www.datacenters.google/locations/oregon/',
  }),
  Object.freeze({
    id: 'google-loudoun', name: 'Google Loudoun County, Virginia', operator: 'Google',
    latitude: 39.12, longitude: -77.56, locationAccuracy: 'city reference' as const,
    sourceUrl: 'https://www.datacenters.google/locations/virginia/',
  }),
]);

export type ModeledJobOrigin = DataCenter & {
  jobId: string;
  simulated: true;
  kind: 'modeled-job-origin';
  label: string;
};

/** work-01, work-02, work-03 cycle in catalog order; other IDs use a stable display assignment.
 * Assigns synthetic admission events only. No operator workload, telemetry or transfer is connected. */
export function originForJob(jobId: string): ModeledJobOrigin {
  const sequence = /^work-(\d+)$/.exec(jobId);
  const number = sequence ? Number(sequence[1]) : NaN;
  const index = Number.isSafeInteger(number) && number > 0 ? (number - 1) % dataCenters.length
    : Array.from(jobId).reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 0) % dataCenters.length;
  return { ...dataCenters[index], jobId, simulated: true, kind: 'modeled-job-origin',
    label: 'Simulated job source; no facility workload connection' };
}
