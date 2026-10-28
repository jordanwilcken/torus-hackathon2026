import type { getEnergyMap } from '../../core/energy/getEnergyMap';
import type { SlotReference } from '../../core/energy/SlotReference.type';
import type { JobOutcome } from '../../core/scheduling/JobOutcome.type';
import { JobPriceChoice, PriceDetails, PriceStrip } from '../scheduling/PostedPrices';
import type { PriceHour, JobPriceChoiceProps } from '../scheduling/PostedPrices.type';

type Props = {
  map: ReturnType<typeof getEnergyMap>;
  jobName: string;
  outcome?: JobOutcome;
  execution?: JobPriceChoiceProps['execution'];
  history?: JobPriceChoiceProps['history'];
  inspected?: SlotReference;
  onInspect: (reference: SlotReference) => void;
};

/** Displays the runtime's retained publication. It never recomputes offers or routing. */
export function ReplayPrices({ map, jobName, outcome, execution, history, inspected, onInspect }: Props) {
  const sites = [...map.sites.values()].map(site => ({
    id: site.id, name: site.name ?? site.id,
    unavailable: site.slots.filter(reading => !reading.snapshot.slot).length,
    hours: site.slots.flatMap((reading): PriceHour[] => reading.snapshot.slot ? [{
      reference: reading.reference, window: reading.snapshot.slot.window,
      snapshot: reading.snapshot, forecast: reading.forecast,
    }] : []),
  }));
  const siteNames = Object.fromEntries(sites.map(site => [site.id, site.name]));
  const inspectedSite = sites.find(site => site.id === inspected?.locationId);
  const inspectedHour = inspectedSite?.hours.find(hour => hour.reference.slotId === inspected?.slotId);
  const rates = sites.flatMap(site => site.hours.flatMap(hour => hour.snapshot.status === 'current' && hour.snapshot.slot
    ? [hour.snapshot.slot.postedUsdPerGpuHour] : []));
  const priceRange = rates.length ? { min: Math.min(...rates), max: Math.max(...rates) } : undefined;
  return <section className="replay-prices" aria-label="Published model prices">
    <header><h2>Prices behind the decision</h2>
      <p>Offers published as of <time dateTime={map.asOf}>{map.asOf}</time>, before this hour’s reservations.
        Later jobs in the same hour may see revised capacity.</p>
      <p>Declared site energy and capacity; prices are computed by the model.</p></header>
    <div className="replay-price-layout"><div className="replay-price-strips">
      {sites.map(site => <div key={site.id}>
        <PriceStrip siteName={site.name} hours={site.hours} inspected={inspected} priceRange={priceRange}
          selected={outcome?.selected ? outcome.allocation : undefined} onInspect={hour => onInspect(hour.reference)} />
        {site.unavailable > 0 && <p>{site.unavailable} offer(s) unavailable; no price or interval supplied.</p>}
      </div>)}
      {!sites.length && <p>No site offers are available.</p>}
    </div><JobPriceChoice jobName={jobName} outcome={outcome} siteNames={siteNames} execution={execution} history={history} /></div>
    {inspectedHour && <PriceDetails siteName={inspectedSite!.name} hour={inspectedHour} />}
  </section>;
}
