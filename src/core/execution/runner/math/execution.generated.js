// Generated from execution.math.md. Edit the Markdown and regenerate.
// Compiler: @cortex-js/compute-engine 0.171.0; strict scalar JavaScript.
// Source SHA-256: 392503acf1ec371e5a78b65bd77fb432fee47f1206e641ae3b23576f447345b7

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "capacity": number, "used": number }} input
 * @returns {number}
 */
export function unreservedGpus(input) {
  const _ = input;
  return _.capacity + -_.used;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "gpus": number, "kWhPerGpuHour": number }} input
 * @returns {number}
 */
export function computePower(input) {
  const _ = input;
  return _.gpus * _.kWhPerGpuHour;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "durationMs": number, "gpus": number, "remainingGpuH": number }} input
 * @returns {number}
 */
export function completedWork(input) {
  const _ = input;
  return Math.min(_.remainingGpuH, (_.durationMs * _.gpus) / 3600000);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "kWhPerGpuHour": number, "workGpuH": number }} input
 * @returns {number}
 */
export function workEnergy(input) {
  const _ = input;
  return _.kWhPerGpuHour * _.workGpuH;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "gpus": number, "remainingGpuH": number }} input
 * @returns {number}
 */
export function requiredHours(input) {
  const _ = input;
  return _.remainingGpuH / _.gpus;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "remainingMs": number, "windowMs": number }} input
 * @returns {number}
 */
export function loadDuration(input) {
  const _ = input;
  return Math.min(_.windowMs, _.remainingMs);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "completedGpuH": number, "remainingGpuH": number }} input
 * @returns {number}
 */
export function remainingWork(input) {
  const _ = input;
  return -_.completedGpuH + _.remainingGpuH;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "gridKWh": number, "solarKWh": number }} input
 * @returns {number}
 */
export function directComputeEnergy(input) {
  const _ = input;
  return _.gridKWh + _.solarKWh;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "batteryKWh": number, "directKWh": number }} input
 * @returns {number}
 */
export function totalComputeEnergy(input) {
  const _ = input;
  return _.batteryKWh + _.directKWh;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "completedGpuH": number, "postedUsdPerGpuHour": number }} input
 * @returns {number}
 */
export function postedCharge(input) {
  const _ = input;
  return _.completedGpuH * _.postedUsdPerGpuHour;
}
