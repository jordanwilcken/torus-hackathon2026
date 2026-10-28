import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JobPriceChoice, PriceDetails, PriceStrip } from '../../../src/ui/scheduling/PostedPrices';
import type { PriceHour } from '../../../src/ui/scheduling/PostedPrices.type';
import './component-prices.css';

import { at, history, scenario, siteNames, type Scene } from './price-preview-data';

let show = (_scene: Scene) => {};
let read = () => scenario('selected');
Object.assign(window, { pricePreview: { show: (scene: Scene) => show(scene), read: () => structuredClone(read()) } });

function Preview() {
  const [scene, setScene] = useState<Scene>('selected');
  const [data, setData] = useState(() => scenario('selected'));
  const [inspected, setInspected] = useState<PriceHour | undefined>(data.sites[0].hours[0]);
  show = next => {
    const nextData = scenario(next);
    setScene(next); setData(nextData); setInspected(nextData.sites[0].hours[0]);
  };
  read = () => data;
  return <main className="price-preview">
    <header className="price-preview-brand"><a href="#" aria-label="Sunchaser">sunchaser<span aria-hidden="true">✳</span></a><span>COMPUTE, WITH THE GRID.</span></header>
    <div className="price-preview-intro"><div><p className="price-preview-kicker">PRICE / TIMING</p><h1>A good moment to run.</h1><p>See the next window. Understand the choice.</p></div>
      <p className="price-preview-context"><span>Simulated preview · selection only</span><br /><time dateTime={at}>28 Oct 2026 · 12:00 UTC</time></p></div>
    <div className="price-preview-layout">
      <section className="price-preview-prices" aria-label="Upcoming prices">
        <header><h2>Prices ahead</h2><span>UTC · USD / GPU-hour</span></header>
        {data.sites.map(site => <PriceStrip key={site.id} siteName={site.name} hours={site.hours}
          selected={data.outcome?.selected ? data.outcome.allocation : undefined} inspected={inspected?.reference}
          priceRange={{ min: .045, max: .11 }} onInspect={setInspected} />)}
        <p className="price-preview-legend"><span><i />Lower price</span><span><i />Higher price</span><span><i />Sold out</span><span>Tap an hour for details</span></p>
        <PriceDetails siteName={inspected ? siteNames[inspected.reference.locationId as keyof typeof siteNames] : 'Site'} hour={inspected} />
      </section>
      <JobPriceChoice jobName="Training batch" outcome={data.outcome} siteNames={siteNames} history={scene === 'empty' ? [] : history} />
    </div>
    <footer className="price-preview-footer"><p>Preview states</p><nav aria-label="Preview states">{(['selected', 'waiting', 'stale', 'unknown', 'revised', 'empty'] as const).map(state =>
      <button type="button" key={state} aria-pressed={scene === state} onClick={() => show(state)}>{state === 'unknown' ? 'Unavailable' : state}</button>)}</nav></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
