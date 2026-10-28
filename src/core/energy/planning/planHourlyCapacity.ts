import type { CapacityPlanInput, HourlyCapacityPlan, PlannedCapacitySlot } from './CapacityPlan.types.js';
import { deadlineCoverage } from './deadlineCoverage.js';

const hour = 3_600_000;

/** Pure horizon planner. Ledger publications bound supply; this layer only shapes soft quotas. */
export function planHourlyCapacity(input: CapacityPlanInput): HourlyCapacityPlan {
  validate(input);
  const at = Date.parse(input.asOf);
  const slots = physicalSlots(input);
  const readyWork = input.jobs.filter(job => !['done', 'missed'].includes(job.state) &&
    Date.parse(job.readyAt) <= at).reduce((sum, job) => sum + job.remainingGpuH, 0);
  const currentFree = slots.filter(slot => Date.parse(slot.window.startAt) === at)
    .reduce((sum, slot) => sum + slot.physicalFreeGpus, 0);
  const backlogHours = currentFree > 0 ? readyWork / currentFree : readyWork > 0 ? null : 0;
  const overloaded = backlogHours === null || backlogHours > input.policy.backlogHoursThreshold;
  const missingPreference = slots.some(slot => slot.physicalFreeGpus > 0 && slot.carbonGPerKWh === null);
  const reasons: string[] = [];
  if (slots.some(slot => slot.status !== 'current')) reasons.push('Missing or stale physical inputs close affected capacity.');
  if (missingPreference) reasons.push('Carbon preference is unavailable; planning uses known physical capacity without a carbon ranking.');
  if (overloaded) reasons.push('Ready backlog exceeds the declared threshold; carbon-blind capacity fallback is active.');
  const carbonBlind = missingPreference || overloaded;
  const safetyMargin = Math.min(input.policy.maximumSafetyMargin,
    input.policy.safetyMargin + input.forecastErrorFraction +
    (backlogHours === null ? input.policy.maximumSafetyMargin :
      Math.max(0, backlogHours / input.policy.backlogHoursThreshold - 1) * input.policy.safetyMargin));
  const physical = slots.map(slot => slot.physicalFreeGpus);
  const witness = deadlineCoverage(input.jobs, slots, physical, input.readiness ?? [], input.asOf, carbonBlind);
  const desired = carbonBlind ? [...physical] : [...witness.opened];
  const arrivalCaps = slots.map(() => 0);
  for (const coverage of witness.deadlines) {
    const job = input.jobs.find(job => job.id === coverage.jobId)!;
    if (!coverage.locationId || coverage.locationId === job.currentLocation) continue;
    const arrival = input.readiness?.find(value => value.jobId === job.id && value.locationId === coverage.locationId);
    const index = slots.findIndex(slot => slot.locationId === coverage.locationId &&
      Date.parse(slot.window.startAt) === Date.parse(arrival?.readyAt ?? ""));
    if (index >= 0) arrivalCaps[index] = Math.min(physical[index], arrivalCaps[index] + job.maxGpus);
  }
  const currentSlots = new Set(slots.filter(slot => Date.parse(slot.window.startAt) === at).map(slot => slot.slotId));
  const coverageByJob = new Map(witness.deadlines.map(coverage => [coverage.jobId, coverage]));
  const readyJobs = input.jobs.filter(job => !["done", "missed", "moving"].includes(job.state) &&
    job.remainingGpuH > 0 && Math.max(Date.parse(job.readyAt), Date.parse(job.window.startAt)) <= at);
  const futureCovered = (jobId: string): boolean => {
    const coverage = coverageByJob.get(jobId);
    return coverage?.status === "covered" && coverage.allocations.every(allocation => !currentSlots.has(allocation.slotId));
  };
  // A valid shared future witness may defer a whole site even inside the price-wait escape window.
  // Margin and hysteresis must not silently reopen its dirtier current quota. No future reservation is made.
  const deferred = slots.map((slot, index) => {
    const here = readyJobs.filter(job => job.currentLocation === slot.locationId);
    return !carbonBlind && Date.parse(slot.window.startAt) === at && witness.opened[index] === 0 &&
      arrivalCaps[index] === 0 && here.length > 0 && here.every(job => futureCovered(job.id));
  });
  if (deferred.some(Boolean)) reasons.push("Current quota is deferred where the shared plan covers all ready work in eligible future hours; future inputs remain conditional.");
  if (!carbonBlind) addMargin(desired, physical, slots, input.jobs, witness.deadlines, safetyMargin, deferred);
  for (const [index, cap] of arrivalCaps.entries()) desired[index] = Math.max(desired[index], cap);
  const urgentLocations = new Set(readyJobs.filter(job => !futureCovered(job.id) &&
    (Date.parse(job.window.endAt) - at) / hour - Math.ceil(job.remainingGpuH / job.maxGpus) <= 1)
    .map(job => job.currentLocation));
  const urgent = slots.map(slot => Date.parse(slot.window.startAt) === at && urgentLocations.has(slot.locationId));
  const escapeApplied = urgent.some((value, index) => value && desired[index] < physical[index]);
  if (escapeApplied)
    reasons.push("Deadline escape opens current physical headroom for ready urgent work; hard limits remain in force.");
  for (const [index, value] of urgent.entries()) if (value) desired[index] = physical[index];
  const previous = new Map(input.previous?.slots.map(slot => [key(slot), slot]) ?? []);
  const damped = [...desired];
  const lastBySite = new Map<string, number>();
  let hardCut = false;
  for (const [index, slot] of slots.entries()) {
    const prior = previous.get(key(slot));
    if (prior) {
      const priorFree = Math.max(0, prior.capGpus - slot.usedGpus);
      if (physical[index] < priorFree) hardCut = true;
      damped[index] = Math.min(physical[index],
        Math.max(Math.max(0, priorFree - input.policy.maximumChangeGpus),
          Math.min(desired[index], priorFree + input.policy.maximumChangeGpus)));
    }
    const last = lastBySite.get(slot.locationId);
    if (last !== undefined) damped[index] = Math.min(physical[index],
      Math.max(Math.max(0, last - input.policy.maximumRampGpus),
        Math.min(damped[index], last + input.policy.maximumRampGpus)));
    lastBySite.set(slot.locationId, damped[index]);
  }
  // Smoothing is soft. Preserve a feasible deadline witness before retaining spare margin.
  // Lower physical limits always win, including a reduction larger than either damping limit.
  const protectedCaps = damped.map((cap, index) => deferred[index] ? 0 :
    urgent[index] ? physical[index] : Math.max(cap, witness.opened[index], arrivalCaps[index]));
  if (protectedCaps.some((cap, index) => cap > damped[index]))
    reasons.push('Deadline coverage takes precedence over soft damping or ramp limits.');
  if (hardCut) reasons.push('A tighter physical limit took effect immediately, overriding damping.');
  const finalWitness = deadlineCoverage(input.jobs, slots, protectedCaps, input.readiness ?? [], input.asOf, carbonBlind);
  if (finalWitness.deadlines.some(job => job.status === 'shortfall'))
    reasons.push('At least one job has a conditional-plan shortfall; no aggregate completion promise.');
  for (const [index, slot] of slots.entries()) {
    slot.capGpus = slot.usedGpus + protectedCaps[index];
    if (slot.status === 'current') slot.reason = deferred[index]
      ? 'Ready work is conditionally covered in eligible future hours; current quota remains closed.'
      : protectedCaps[index] === 0 ? 'No flexible work or safety margin is opened in this hour.'
      : carbonBlind ? 'Physical-safe carbon-blind fallback; future capacity remains conditional.'
        : 'Deadline-first carbon preference with safety margin; future capacity remains conditional.';
  }
  const safetyMarginRequestedGpuH = witness.deadlines.reduce((sum, job) => sum + job.plannedGpuH, 0) * safetyMargin;
  const safetyMarginOpenedGpuH = protectedCaps.reduce((sum, cap, index) => sum + Math.max(0, cap - finalWitness.opened[index]), 0);
  if (safetyMarginOpenedGpuH + 1e-9 < safetyMarginRequestedGpuH)
    reasons.push("The requested safety margin could not be fully opened within eligible physical capacity and deliberate current-hour deferrals; see target and opened GPU-hours.");
  return {
    asOf: input.asOf, horizon: { ...input.horizon }, mode: slots.some(slot => slot.status !== "current") || carbonBlind ||
      finalWitness.deadlines.some(job => job.status === "shortfall") || escapeApplied ? "degraded" : "planned",
    reasons, safetyMargin,
    safetyMarginRequestedGpuH, safetyMarginOpenedGpuH,
    backlogHours, slots, deadlines: finalWitness.deadlines,
  };
}

function addMargin(caps: number[], physical: number[], slots: PlannedCapacitySlot[],
  cohort: CapacityPlanInput['jobs'], jobs: HourlyCapacityPlan['deadlines'], margin: number, deferred: readonly boolean[]): void {
  const planned = jobs.reduce((sum, job) => sum + job.plannedGpuH, 0);
  let extra = planned * margin;
  const ordered = slots.map((slot, index) => ({ slot, index })).filter(({ slot, index }) => !deferred[index] && jobs.some(coverage => {
    const job = cohort.find(job => job.id === coverage.jobId)!;
    return coverage.locationId === slot.locationId && Date.parse(slot.window.startAt) >=
      Math.max(Date.parse(job.readyAt), Date.parse(job.window.startAt)) &&
      Date.parse(slot.window.endAt) <= Date.parse(job.window.endAt);
  }))
    .sort((left, right) => (left.slot.carbonGPerKWh ?? Infinity) - (right.slot.carbonGPerKWh ?? Infinity) ||
      Date.parse(left.slot.window.startAt) - Date.parse(right.slot.window.startAt));
  for (const { index } of ordered) {
    if (extra <= 1e-9) break;
    const added = Math.min(physical[index] - caps[index], Math.ceil(extra));
    caps[index] += added;
    extra -= added;
  }
}

function physicalSlots(input: CapacityPlanInput): PlannedCapacitySlot[] {
  const at = Date.parse(input.asOf);
  const result: PlannedCapacitySlot[] = [];
  for (let start = at; start < Date.parse(input.horizon.endAt); start += hour) {
    for (const site of input.sites) {
      const end = start + hour;
      const matches = site.snapshots.filter(snapshot => Date.parse(snapshot.slot?.window.startAt ?? '') === start &&
        Date.parse(snapshot.slot?.window.endAt ?? '') === end && snapshot.slot?.locationId === site.locationId);
      const snapshot = matches.length === 1 ? matches[0] : undefined;
      const slot = snapshot?.slot;
      const age = (at - Date.parse(snapshot?.observedAt ?? '')) / 60_000;
      const valid = snapshot?.status === 'current' && Boolean(snapshot.version?.trim()) && Boolean(snapshot.source.trim()) &&
        Number.isFinite(age) && age >= 0 && age <= input.maximumAgeMinutes && slot !== undefined &&
        [slot.capGpus, slot.usedGpus].every(Number.isInteger) && slot.usedGpus >= 0 && slot.capGpus >= slot.usedGpus &&
        [slot.availablePowerKW, slot.availableEnergyKWh].every(value => Number.isFinite(value) && value >= 0) &&
        (start > at || !snapshot.projected);
      const physicalFreeGpus = valid ? Math.max(0, Math.floor(Math.min(slot!.capGpus - slot!.usedGpus,
        slot!.availablePowerKW / site.kWhPerGpuHour, slot!.availableEnergyKWh / site.kWhPerGpuHour) + 1e-9)) : 0;
      const preference = site.preferences.find(value => value.version === snapshot?.version &&
        Date.parse(value.window.startAt) === start && Date.parse(value.window.endAt) === end);
      const status = valid ? 'current' as const : snapshot?.status === 'stale' ||
        snapshot?.status === 'current' && Number.isFinite(age) && age > input.maximumAgeMinutes ? 'stale' as const : 'unavailable' as const;
      result.push({
        locationId: site.locationId, slotId: slot?.id ?? site.locationId + '@' + new Date(start).toISOString(),
        computeProfile: site.computeProfile, window: { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() },
        kWhPerGpuHour: site.kWhPerGpuHour, physicalFreeGpus, usedGpus: valid ? slot!.usedGpus : 0,
        capGpus: valid ? slot!.usedGpus : 0, conditional: start > at || Boolean(snapshot?.projected),
        status, source: snapshot?.source ?? 'No matching ledger publication', version: snapshot?.version,
        observedAt: snapshot?.observedAt,
        carbonGPerKWh: preference && Number.isFinite(preference.carbonGPerKWh) && preference.carbonGPerKWh >= 0
          ? preference.carbonGPerKWh : null,
        reason: status === 'current' ? '' : 'No current, known physical capacity; new work is closed.',
      });
    }
  }
  return result;
}

function validate(input: CapacityPlanInput): void {
  const at = Date.parse(input.asOf), start = Date.parse(input.horizon.startAt), end = Date.parse(input.horizon.endAt);
  const policy = input.policy;
  if (![at, start, end].every(Number.isFinite) || at < start || at >= end ||
      [at, start, end].some(value => value % hour !== 0) ||
      !Number.isFinite(input.maximumAgeMinutes) || input.maximumAgeMinutes < 0 ||
      !Number.isFinite(input.forecastErrorFraction) || input.forecastErrorFraction < 0 ||
      !Number.isFinite(policy.safetyMargin) || policy.safetyMargin < 0 ||
      !Number.isFinite(policy.maximumSafetyMargin) || policy.maximumSafetyMargin < policy.safetyMargin ||
      ![policy.maximumChangeGpus, policy.maximumRampGpus].every(value => Number.isInteger(value) && value >= 0) ||
      !Number.isFinite(policy.backlogHoursThreshold) || policy.backlogHoursThreshold <= 0)
    throw new RangeError('Capacity planning requires an hourly horizon and finite nonnegative policy inputs.');
  if (new Set(input.sites.map(site => site.locationId)).size !== input.sites.length ||
      input.sites.some(site => !site.locationId || !site.computeProfile ||
        !Number.isFinite(site.kWhPerGpuHour) || site.kWhPerGpuHour <= 0))
    throw new RangeError('Capacity planning requires unique sites and positive declared energy profiles.');
  if (new Set(input.jobs.map(job => job.id)).size !== input.jobs.length || input.jobs.some(job =>
    !job.id || !Number.isInteger(job.maxGpus) || job.maxGpus <= 0 ||
    !Number.isFinite(job.remainingGpuH) || job.remainingGpuH < 0 ||
    ![job.readyAt, job.window.startAt, job.window.endAt].every(value => Number.isFinite(Date.parse(value))) ||
    Date.parse(job.window.endAt) <= Date.parse(job.window.startAt)))
    throw new RangeError('Capacity planning requires valid jobs with unique identities, deadlines and GPU limits.');
  if (input.readiness?.some(value => !Number.isFinite(Date.parse(value.readyAt))))
    throw new RangeError('Remote readiness must be a known timestamp, never an implicit zero-duration transfer.');
}

function key(slot: Pick<PlannedCapacitySlot, 'locationId' | 'window'>): string {
  return slot.locationId + '/' + Date.parse(slot.window.startAt);
}
