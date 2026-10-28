import type { SiteWeatherSnapshot } from './SiteWeather.type';
import type { CaisoSnapshot } from '../server/caiso';
import type { EiaApiSnapshot } from '../core/energy/data/eiaApi';
import type { ReplayProgress } from '../core/execution/replay/createPairedReplaySession';

export type CapturedSource<T> = { revision: string; snapshot: T; status: 'ready' | 'stale' };
export type FleetSourceBundle = {
  capturedAt: string;
  weather: CapturedSource<SiteWeatherSnapshot> | null;
  caiso: CapturedSource<CaisoSnapshot> | null;
  eia: CapturedSource<EiaApiSnapshot> | null;
};
/** Immutable freeze: newer source context never rewrites the inputs or receipts that produced the run. */
export type FrozenFleetSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  runInputs: FleetSourceBundle;
  latestContext: FleetSourceBundle;
  progress: Omit<ReplayProgress, 'map'>;
};
