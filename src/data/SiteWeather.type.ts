export type SiteWeatherVariable = 'shortwave_radiation' | 'shortwave_radiation_instant' | 'temperature_2m' | 'cloud_cover';
export type SiteWeatherSelection = {
  sites: ReadonlyArray<{ id: string; latitude: number; longitude: number }>;
  forecastDays: number;
  variables: ReadonlyArray<SiteWeatherVariable>;
};
export type SiteWeatherCoverage = {
  variable: SiteWeatherVariable;
  status: 'complete' | 'partial' | 'unavailable';
  expectedHours: number;
  availableHours: number;
  missingHours: number;
  notes: string[];
};

/** Provider weather forecast, not measured site generation or permission to execute work. */
export type SiteWeatherSnapshot = {
  source: 'Open-Meteo';
  retrievedAt: string;
  /** Absent only in the original radiation-only publication format. */
  metadata?: {
    sourceKind: 'forecast';
    model: 'best_match';
    /** The forecast endpoint does not provide a model issuance timestamp. */
    issuedAt: null;
    selection: SiteWeatherSelection;
    variables: Partial<Record<SiteWeatherVariable, {
      unit: 'W/m²' | '°C' | '%'; temporalBasis: 'preceding-hour-average' | 'instantaneous';
    }>>;
  };
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
    /** Values at this timestamp, distinct from the preceding-hour radiation average. */
    instantaneous?: Array<{
      at: string;
      shortwaveRadiationInstantWm2?: number | null;
      temperatureC?: number | null;
      cloudCoverPercent?: number | null;
    }>;
    coverage?: SiteWeatherCoverage[];
  }>;
};
