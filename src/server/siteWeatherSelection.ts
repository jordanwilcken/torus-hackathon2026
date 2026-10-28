import { modeledSites } from '../data/modeledSites.ts';
import type { SiteWeatherSelection, SiteWeatherVariable, SiteWeatherSnapshot } from '../data/SiteWeather.type.ts';

export const weatherVariables = {
  shortwave_radiation: { unit: 'W/m²', temporalBasis: 'preceding-hour-average' },
  shortwave_radiation_instant: { unit: 'W/m²', temporalBasis: 'instantaneous' },
  temperature_2m: { unit: '°C', temporalBasis: 'instantaneous' },
  cloud_cover: { unit: '%', temporalBasis: 'instantaneous' },
} as const;

/** Validate before collection or restoration and retain no caller-owned mutable objects. */
export function selectSiteWeather(supplied?: SiteWeatherSelection): SiteWeatherSelection {
  const selection = supplied ?? {
    sites: modeledSites.map(({ id, latitude, longitude }) => ({ id, latitude, longitude })),
    forecastDays: 3, variables: ['shortwave_radiation'],
  };
  if (!selection || !Array.isArray(selection.sites) || selection.sites.length < 1 || selection.sites.length > 12)
    throw new Error('Weather selection requires 1 to 12 sites');
  if (!Number.isInteger(selection.forecastDays) || selection.forecastDays < 1 || selection.forecastDays > 7)
    throw new Error('Weather forecastDays must be an integer from 1 to 7');
  const ids = new Set<string>();
  const sites = selection.sites.map(site => {
    if (!site || typeof site.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(site.id))
      throw new Error('Weather site id must be 1 to 64 letters, digits, hyphens or underscores');
    if (ids.has(site.id)) throw new Error('Weather site ids must be unique');
    ids.add(site.id);
    if (!Number.isFinite(site.latitude) || site.latitude < -90 || site.latitude > 90)
      throw new Error('Weather site latitude must be between -90 and 90');
    if (!Number.isFinite(site.longitude) || site.longitude < -180 || site.longitude > 180)
      throw new Error('Weather site longitude must be between -180 and 180');
    return { id: site.id, latitude: site.latitude, longitude: site.longitude };
  });
  if (!Array.isArray(selection.variables) || !selection.variables.includes('shortwave_radiation') ||
      selection.variables.some(variable => !Object.hasOwn(weatherVariables, variable)) ||
      new Set(selection.variables).size !== selection.variables.length)
    throw new Error('Weather variables must be unique supported variables including shortwave_radiation');
  return { sites, forecastDays: selection.forecastDays, variables: [...selection.variables] as SiteWeatherVariable[] };
}

export function matchesWeatherSelection(snapshot: SiteWeatherSnapshot, selection: SiteWeatherSelection): boolean {
  const prior = snapshot.metadata?.selection ?? selectSiteWeather();
  if (JSON.stringify(prior) !== JSON.stringify(selection)) return false;
  return snapshot.sites.length === selection.sites.length && snapshot.sites.every((site, index) => {
    const requested = selection.sites[index];
    return site.locationId === requested.id && site.latitude === requested.latitude && site.longitude === requested.longitude;
  });
}
