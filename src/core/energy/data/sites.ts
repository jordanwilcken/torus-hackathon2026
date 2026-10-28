import snapshot from './snapshots/eia930-pace-2025-07-31_2025-08-07.json';
import { parseEia930Snapshot } from './eia930.js';
import { SnapshotRegionalGrid } from './SnapshotRegionalGrid.js';

const regionEvidence = 'https://www.rockymountainpower.net/content/dam/pcorp/documents/en/rockymountainpower/rates-regulation/wyoming/filings/20000-671-er-24/12_Rick_A_Vail_Direct_Testimony_and_Exhibits.pdf';
const eiaDefinitions = 'https://www.eia.gov/electricity/930-content/about.html';
const saltLakeEvidence = 'https://www.rockymountainpower.net/content/dam/pcorp/documents/en/rockymountainpower/rates-regulation/utah/filings/docket-25-035-06/Application_and_Exhibits.pdf';
const cedarCityEvidence = 'https://www.rockymountainpower.net/about/newsroom/news-releases/utah-public-safety-power-shutoff-warning.html';

export const disclaimer = 'These pins are illustrative locations, not Torus installations or verified hardware. Coordinates are approximate city centers; retail boundaries apply at address level, so utility and balancing-authority mappings are city-level illustrations.';
export const region = {
  id: 'PACE', name: 'PacifiCorp East', operator: 'PacifiCorp', utility: 'Rocky Mountain Power', eiaCode: 'PACE',
  evidenceUrls: [regionEvidence, eiaDefinitions],
} as const;
export const sites = [
  {
    id: 'salt-lake-city-ut', name: 'Salt Lake City illustrative site', city: 'Salt Lake City', state: 'UT', lat: 40.76, lon: -111.89,
    regionId: 'PACE', illustrative: true, torusInstallation: false, disclaimer,
    mapping: {
      utility: 'Rocky Mountain Power', balancingAuthority: 'PACE',
      evidence: [
        { url: saltLakeEvidence, claim: 'RMP Utah filing lists Salt Lake City among communities with Rocky Mountain Power customers; no address-level boundary is asserted.', checkedAt: '2026-10-27' },
        { url: regionEvidence, claim: 'PacifiCorp operates PACE and PACW balancing authority areas; PACE includes its Utah system.', checkedAt: '2026-10-27' },
      ],
    },
  },
  {
    id: 'cedar-city-ut', name: 'Cedar City illustrative site', city: 'Cedar City', state: 'UT', lat: 37.68, lon: -113.06,
    regionId: 'PACE', illustrative: true, torusInstallation: false, disclaimer,
    mapping: {
      utility: 'Rocky Mountain Power', balancingAuthority: 'PACE',
      evidence: [
        { url: cedarCityEvidence, claim: 'RMP public safety power shutoff notice names some portions of Cedar City on its system; no citywide or address-level coverage is asserted.', checkedAt: '2026-10-27' },
        { url: regionEvidence, claim: 'PacifiCorp operates PACE and PACW balancing authority areas; PACE includes its Utah system.', checkedAt: '2026-10-27' },
      ],
    },
  },
] as const;

export function snapshotGrid(): SnapshotRegionalGrid {
  return new SnapshotRegionalGrid([parseEia930Snapshot(snapshot)]);
}
