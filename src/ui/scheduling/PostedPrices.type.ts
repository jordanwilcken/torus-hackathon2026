import type { TimeWindow } from '../../core/TimeWindow.type';
import type { SlotSnapshot } from '../../core/energy/SlotSnapshot.type';
import type { SlotReference } from '../../core/energy/SlotReference.type';
import type { SlotForecast } from '../../core/energy/SlotForecast.type';
import type { Allocation } from '../../core/scheduling/Allocation.type';
import type { JobOutcome } from '../../core/scheduling/JobOutcome.type';

/** Prepared display data. A present slot matches reference/window; absent readings still retain their place. */
export type PriceHour = {
  reference: SlotReference;
  window: TimeWindow;
  snapshot: SlotSnapshot;
  forecast?: SlotForecast;
  breakdown?: { electricityUsdPerGpuHour?: number; carbonUsdPerGpuHour?: number };
};

export type PriceStripProps = {
  siteName: string;
  hours: readonly PriceHour[];
  selected?: Allocation;
  inspected?: SlotReference;
  /** Supply the same range to adjacent strips when comparing prices across sites. */
  priceRange?: { min: number; max: number };
  onInspect: (hour: PriceHour) => void;
};

export type PriceDetailsProps = { siteName: string; hour?: PriceHour };
export type JobPriceChoiceProps = {
  jobName: string;
  outcome?: JobOutcome;
  siteNames: Readonly<Record<string, string>>;
  history?: readonly { at: string; reason: string }[];
};
