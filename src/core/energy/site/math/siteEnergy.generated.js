// Generated from siteEnergy.math.md. Edit the Markdown and regenerate.
// Compiler: @cortex-js/compute-engine 0.171.0; strict scalar JavaScript.
// Source SHA-256: ee6ba3e7f7689b9a50b2b0b4625ccbc04fb95fcfcc01dc311136ad13bda092cd

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "durationHours": number, "powerKW": number }} input
 * @returns {number}
 */
export function energyForPeriod(input) {
  const _ = input;
  return _.durationHours * _.powerKW;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "computeKWh": number, "fixedKWh": number }} input
 * @returns {number}
 */
export function totalDemand(input) {
  const _ = input;
  return _.computeKWh + _.fixedKWh;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "demandKWh": number, "solarKWh": number }} input
 * @returns {number}
 */
export function unmetDemand(input) {
  const _ = input;
  return Math.max(0, _.demandKWh + -_.solarKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "protectedKWh": number, "storedKWh": number }} input
 * @returns {number}
 */
export function usableStorage(input) {
  const _ = input;
  return Math.max(0, -_.protectedKWh + _.storedKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "dischargeEfficiency": number, "dischargeLimitKWh": number, "unmetKWh": number, "usableKWh": number }} input
 * @returns {number}
 */
export function batteryDelivery(input) {
  const _ = input;
  return Math.min(_.unmetKWh, _.dischargeLimitKWh, _.dischargeEfficiency * _.usableKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "batteryKWh": number, "unmetKWh": number }} input
 * @returns {number}
 */
export function requiredGridImport(input) {
  const _ = input;
  return Math.max(0, -_.batteryKWh + _.unmetKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "batteryKWh": number, "dischargeEfficiency": number, "usableKWh": number }} input
 * @returns {number}
 */
export function storageWithdrawal(input) {
  const _ = input;
  return Math.min(_.usableKWh, _.batteryKWh / _.dischargeEfficiency);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "protectedKWh": number, "storedKWh": number, "withdrawnKWh": number }} input
 * @returns {number}
 */
export function storageAfterDischarge(input) {
  const _ = input;
  return Math.max(_.protectedKWh, _.storedKWh + -_.withdrawnKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "demandKWh": number, "solarKWh": number }} input
 * @returns {number}
 */
export function surplusSolar(input) {
  const _ = input;
  return Math.max(0, -_.demandKWh + _.solarKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "capacityKWh": number, "chargeEfficiency": number, "chargeLimitKWh": number, "remainingKWh": number, "surplusKWh": number }} input
 * @returns {number}
 */
export function solarCharging(input) {
  const _ = input;
  return Math.max(0, Math.min(_.surplusKWh, _.chargeLimitKWh, (_.capacityKWh + -_.remainingKWh) / _.chargeEfficiency));
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "capacityKWh": number, "chargeEfficiency": number, "chargeKWh": number, "remainingKWh": number }} input
 * @returns {number}
 */
export function storageAfterCharge(input) {
  const _ = input;
  return Math.min(_.capacityKWh, _.chargeEfficiency * _.chargeKWh + _.remainingKWh);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "chargeKWh": number, "surplusKWh": number }} input
 * @returns {number}
 */
export function curtailedSolar(input) {
  const _ = input;
  return Math.max(0, -_.chargeKWh + _.surplusKWh);
}
