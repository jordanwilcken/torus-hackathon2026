import type { SiteWeatherSnapshot } from './SiteWeather.type';
import { createFeedClient } from './createFeedClient';

/** Construct once in application assembly; city weather is independent of regional grid inputs. */
export function createSiteWeatherClient(options: { fetcher?: typeof fetch; pollMs?: number; now?: () => number } = {}) {
  return createFeedClient<SiteWeatherSnapshot>('/api/weather/sites', options);
}
export type SiteWeatherClient = ReturnType<typeof createSiteWeatherClient>;
