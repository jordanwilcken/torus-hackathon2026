/** Provider weather forecast, not measured site generation or permission to execute work. */
export type SiteWeatherSnapshot = {
  source: 'Open-Meteo';
  retrievedAt: string;
  sites: Array<{
    locationId: string;
    /** Requested modeled city coordinates; provider grid-cell coordinates remain in source evidence. */
    latitude: number;
    longitude: number;
    intervals: Array<{
      /** Open-Meteo shortwave radiation is averaged over this preceding UTC hour. */
      window: { startAt: string; endAt: string };
      shortwaveRadiationWm2: number | null;
    }>;
  }>;
};
