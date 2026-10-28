import type { Eia930Snapshot, Eia930Row } from '../../../../src/core/energy/data/eia930.js';

export const expectedBasis = {
  'consumption-carbon-intensity': 'EIA-930 consumption-based average operational CO2 of electricity consumed in the balancing authority, including interchange (EIA multiregional model); not a generation-weighted lifecycle CO2e proxy or marginal emissions',
  demand: 'EIA-930 reported hourly balancing-authority demand; hourly MWh expressed as average MW',
  generation: 'EIA-930 reported hourly balancing-authority net generation; hourly MWh expressed as average MW; not a carbon intensity',
  interchange: 'EIA-930 reported hourly balancing-authority total interchange; hourly MWh expressed as average MW; positive is net export',
} as const;

// Hand-written test evidence; these values are not an EIA data extract.
export const row = (utcHourEnding = '2025-07-31T06:00:00.000Z'): Eia930Row => ({
  utcHourEnding, localDate: '2025-07-31', localHour: 1, timeZone: 'MDT',
  demandMW: 6000, netGenerationMW: 6100, totalInterchangeMW: 100,
  consumedIntensityLbsPerKWh: 1, imputed: { demand: false, netGeneration: false, totalInterchange: false, generationBySource: false },
});
export const fixture = (): Eia930Snapshot => ({
  schemaVersion: 1, regionId: 'PACE',
  provenance: {
    source: 'EIA-930 PACE workbook', sourceUrl: 'https://www.eia.gov/electricity/gridmonitor/knownissues/xls/PACE.xlsx',
    retrievedAt: '2026-10-27T22:16:00.000Z', sha256: 'a'.repeat(64), sheet: 'Published Hourly Data',
    columns: {
      regionId: 'BA', utcHourEnding: 'UTC time', localDate: 'Local date', localHour: 'Hour', timeZone: 'Time zone',
      demandMW: 'Demand', netGenerationMW: 'Net generation', totalInterchangeMW: 'Total interchange',
      consumedIntensityLbsPerKWh: 'CO2 Emissions Intensity for Consumed Electricity',
      imputedDemand: 'Imputed demand', imputedNetGeneration: 'Imputed net generation', imputedTotalInterchange: 'Imputed total interchange',
    },
    units: { demandMW: 'MWh', netGenerationMW: 'MWh', totalInterchangeMW: 'MWh', consumedIntensityLbsPerKWh: 'lbs/kWh' },
    imputedGenerationColumns: ['Imputed OTH Gen'],
    notes: ['Hand-written fixture, not real data'],
  },
  coverage: { startAt: '2025-07-31T05:00:00.000Z', endAt: '2025-07-31T07:00:00.000Z' },
  rows: [row(), row('2025-07-31T07:00:00.000Z')],
});
