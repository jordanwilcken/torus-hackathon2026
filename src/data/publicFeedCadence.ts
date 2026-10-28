/** Collection cadence while feeds are requested; provider publication can lag. */
export const publicFeedCadence = {
  browserPollMs: 60_000,
  weather: 30 * 60_000,
  market: 5 * 60_000,
  eia: 15 * 60_000,
} as const;
