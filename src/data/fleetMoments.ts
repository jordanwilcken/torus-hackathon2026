import type { FrozenFleetSnapshot } from './FrozenFleet.type';

export type SavedFleetMoment = { revision: string; capture: FrozenFleetSnapshot };
/** Same-origin immutable capture storage. The source API keys never enter this record. */
export async function saveFleetMoment(capture: FrozenFleetSnapshot): Promise<SavedFleetMoment> {
  const response = await fetch('/api/fleet/captures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capture) });
  if (!response.ok) throw new Error('The model is paused, but its frozen moment could not be saved.');
  return response.json();
}
export async function loadFleetMoment(revision: string): Promise<SavedFleetMoment> {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('A frozen moment needs its complete capture ID.');
  const response = await fetch(`/api/fleet/captures?revision=${revision}`);
  if (!response.ok) throw new Error(response.status === 404 ? 'That frozen moment is not stored on this server.' : 'The frozen moment could not be retrieved.');
  return response.json();
}
