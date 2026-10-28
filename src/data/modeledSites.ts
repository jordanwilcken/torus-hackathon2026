/** Weather inputs for modeled assets at city references; these are not observed compute-site locations. */
export const modeledSites = [
  { id: 'A', name: 'Salt Lake City', latitude: 40.7608, longitude: -111.8910, regionId: 'PACE' },
  { id: 'B', name: 'Cedar City', latitude: 37.6775, longitude: -113.0619, regionId: 'PACE' },
  { id: 'C', name: 'Sacramento', latitude: 38.5816, longitude: -121.4944, regionId: 'CISO' },
  { id: 'D', name: 'Austin', latitude: 30.2672, longitude: -97.7431, regionId: 'ERCO' },
  { id: 'E', name: 'Denver', latitude: 39.7392, longitude: -104.9903, regionId: 'PSCO' },
  { id: 'F', name: 'Richmond', latitude: 37.5407, longitude: -77.4360, regionId: 'PJM' },
] as const;
