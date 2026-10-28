import { useState } from 'react';
import solar from '../../../examples/replay/solar-shift.json';
import stream from '../../../examples/replay/job-stream.json';
import type { ReplayScenario } from '../../core/execution/replay/Replay.types';
import { ReplayDemo } from './ReplayDemo';

// This changes only declared inputs. Both outcomes are still calculated by the shared runtime.
const forecastMiss = structuredClone(solar) as ReplayScenario;
forecastMiss.id = 'forecast-miss';
forecastMiss.inputRevision = 'forecast-miss-v1';
forecastMiss.label = 'Synthetic forecast miss; modeled GPU work and energy, not measured hardware';
const missedHour = forecastMiss.sites[0].observations[1];
missedHour.supply!.solarKW = 0;
missedHour.accounting.gridCarbonGPerKWh = 600;
missedHour.accounting.gridUsdPerMWh = 100;

const scenarios = {
  'job-stream': { label: 'Streamed jobs', input: stream as ReplayScenario,
    description: 'Three jobs arrive over four hours. Watch waiting, capacity competition and completed work. Both policies use the same modeled storage.' },
  'solar-shift': { label: 'Wait for solar', input: solar as ReplayScenario,
    description: 'One GPU-hour, three hours, no storage: isolate the effect of waiting for solar. The idle site is counted in both runs.' },
  'forecast-miss': { label: 'Forecast miss', input: forecastMiss,
    description: 'The same solar forecast misses: realized solar falls to zero and grid energy becomes more costly. The comparison can show a loss.' },
};
type ScenarioId = keyof typeof scenarios;

export function ReplayShowcase() {
  const [id, setId] = useState<ScenarioId>('job-stream');
  return <>
    <div className="demo-scenario">
      <label>Modeled scenario<select value={id} onChange={event => setId(event.target.value as ScenarioId)}>
        {Object.entries(scenarios).map(([value, scenario]) => <option key={value} value={value}>{scenario.label}</option>)}
      </select></label>
      <div><p>{scenarios[id].description}</p><small>Changing scenario resets the modeled run. Saved CPU receipts are independent.</small></div>
    </div>
    <ReplayDemo key={id} scenario={scenarios[id].input} />
  </>;
}
