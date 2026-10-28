import { createRoot } from 'react-dom/client';
import { createPublicGridClient } from '../../../src/data/createPublicGridClient';
import { useFeed } from '../../../src/ui/data/useFeed';

const feeds = createPublicGridClient();
const observedWindow = { startAt: '2026-10-28T05:00:00.000Z', endAt: '2026-10-28T06:00:00.000Z' };
function Reader({ name, throughProvider = false }: { name: string; throughProvider?: boolean }) {
  const feed = useFeed(feeds.eia);
  const observations = throughProvider ? feeds.regionalGrid.read('PACE', observedWindow).observations : feed.snapshot?.observations;
  const demand = observations?.find(observation => observation.metric === 'demand');
  return <section aria-label={name} data-revision={feed.revision}>
    <h2>{name}</h2><p>{feed.status}</p>
    <p>{demand ? `${demand.value} MW` : 'No snapshot'}</p>
    <p>Retrieved {feed.snapshot?.retrievedAt ?? 'Unavailable'}</p>
    <p>Interval ends {demand?.window.endAt ?? 'Unavailable'}</p>
  </section>;
}
createRoot(document.getElementById('root')!).render(<main>
  <Reader name="Snapshot reader" />
  <Reader name="Regional provider reader" throughProvider />
</main>);
