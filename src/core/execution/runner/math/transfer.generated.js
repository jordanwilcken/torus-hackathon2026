// Generated from transfer.math.md. Edit the Markdown and regenerate.
// Compiler: @cortex-js/compute-engine 0.171.0; strict scalar JavaScript.
// Source SHA-256: e0a1adbe65ce71de325647706ad2576ee69ce1e1022aa092227933712fd96bfc

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "bandwidthGBPerHour": number, "dataGB": number }} input
 * @returns {number}
 */
export function transferHours(input) {
  const _ = input;
  return _.dataGB / _.bandwidthGBPerHour;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "arrival": number, "origin": number, "tickMs": number }} input
 * @returns {number}
 */
export function gridReadyTime(input) {
  const _ = input;
  return _.origin + _.tickMs * Math.ceil((_.arrival + -_.origin) / _.tickMs);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "dataGB": number, "kWhPerGB": number }} input
 * @returns {number}
 */
export function transferEnergy(input) {
  const _ = input;
  return _.dataGB * _.kWhPerGB;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "dataGB": number, "usdPerGB": number }} input
 * @returns {number}
 */
export function transferCharge(input) {
  const _ = input;
  return _.dataGB * _.usdPerGB;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "energyKWh": number, "gramsPerKWh": number }} input
 * @returns {number}
 */
export function carbonKilograms(input) {
  const _ = input;
  return (_.energyKWh * _.gramsPerKWh) / 1000;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "energyKWh": number, "usdPerMWh": number }} input
 * @returns {number}
 */
export function electricityDollars(input) {
  const _ = input;
  return (_.energyKWh * _.usdPerMWh) / 1000;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "deadline": number, "readyAt": number, "slotEnd": number, "slotStart": number }} input
 * @returns {number}
 */
export function activeHours(input) {
  const _ = input;
  return Math.max(0, Math.min(_.deadline, _.slotEnd) + -Math.max(_.readyAt, _.slotStart)) / 3600000;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "availablePowerKW": number, "kWhPerGpuHour": number }} input
 * @returns {number}
 */
export function powerSupportedGpus(input) {
  const _ = input;
  return _.availablePowerKW / _.kWhPerGpuHour;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "powerGpus": number }} input
 * @returns {number}
 */
export function wholePowerGpus(input) {
  const _ = input;
  return Math.floor(((_.powerGpus !== undefined) ? ((Math.abs(_.powerGpus + -(() => { const _tv1 = _.powerGpus; return (Math.sign(_tv1) * Math.round(Math.abs(_tv1))); })()) <= Math.max(1, Math.abs(_.powerGpus), Math.abs((() => { const _tv2 = _.powerGpus; return (Math.sign(_tv2) * Math.round(Math.abs(_tv2))); })())) * 1.7763568394002505e-15) ? ((() => { const _tv3 = _.powerGpus; return (Math.sign(_tv3) * Math.round(Math.abs(_tv3))); })()) : (_.powerGpus)) : NaN));
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "maxGpus": number, "powerGpus": number, "unreservedGpus": number }} input
 * @returns {number}
 */
export function destinationGpus(input) {
  const _ = input;
  return Math.min(_.maxGpus, _.unreservedGpus, _.powerGpus);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "activeHours": number, "availableEnergyKWh": number, "gpus": number, "kWhPerGpuHour": number }} input
 * @returns {number}
 */
export function slotWork(input) {
  const _ = input;
  return Math.min(_.activeHours * _.gpus, _.availableEnergyKWh / _.kWhPerGpuHour);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "previousGpuH": number, "slotGpuH": number }} input
 * @returns {number}
 */
export function accumulatedWork(input) {
  const _ = input;
  return _.previousGpuH + _.slotGpuH;
}
