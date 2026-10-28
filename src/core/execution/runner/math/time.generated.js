// Generated from time.math.md. Edit the Markdown and regenerate.
// Compiler: @cortex-js/compute-engine 0.171.0; strict scalar JavaScript.
// Source SHA-256: c2e4d7182efae0f6bde220fa25bdb4828331623c4cee8e5bba7106dde9510612

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "end": number, "start": number }} input
 * @returns {number}
 */
export function elapsedMilliseconds(input) {
  const _ = input;
  return _.end + -_.start;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "durationMs": number, "start": number }} input
 * @returns {number}
 */
export function timeAfter(input) {
  const _ = input;
  return _.durationMs + _.start;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "readyAt": number, "windowStart": number }} input
 * @returns {number}
 */
export function readyTime(input) {
  const _ = input;
  return Math.max(_.readyAt, _.windowStart);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "readyAt": number, "tickStart": number, "windowStart": number }} input
 * @returns {number}
 */
export function executionStart(input) {
  const _ = input;
  return Math.max(_.tickStart, _.readyAt, _.windowStart);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "deadline": number, "tickEnd": number }} input
 * @returns {number}
 */
export function executionEnd(input) {
  const _ = input;
  return Math.min(_.tickEnd, _.deadline);
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "at": number, "observedAt": number }} input
 * @returns {number}
 */
export function ageMinutes(input) {
  const _ = input;
  return (_.at + -_.observedAt) / 60000;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "durationHours": number }} input
 * @returns {number}
 */
export function millisecondsForHours(input) {
  const _ = input;
  return 3600000 * _.durationHours;
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "value": number }} input
 * @returns {number}
 */
export function nearestWhole(input) {
  const _ = input;
  return (() => { const _tv1 = _.value; return (Math.sign(_tv1) * Math.round(Math.abs(_tv1))); })();
}

/**
 * Prepared numeric scalars; caller validates inputs and rejects nonfinite calculated results.
 * @param {{ "left": number, "right": number }} input
 * @returns {number}
 */
export function withinRoundoff(input) {
  const _ = input;
  return ((_.left !== undefined && _.right !== undefined) ? ((Math.abs(_.left + -_.right) <= Math.max(1, Math.abs(_.left), Math.abs(_.right)) * 1.7763568394002505e-15) ? (1) : (0)) : NaN);
}
