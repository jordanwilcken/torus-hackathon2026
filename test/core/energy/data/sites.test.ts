import { afterEach, describe, expect, it, vi } from 'vitest';
import { sites, region, disclaimer, snapshotGrid } from '../../../../src/core/energy/data/sites.js';

afterEach(() => vi.unstubAllGlobals());
describe('illustrative Utah pins and offline snapshot factory', () => {
  it('exposes exactly two city pins with explicit hardware disclaimers and mapping evidence', () => {
    expect(sites).toHaveLength(2);
    expect(sites.map(s => s.city)).toEqual(['Salt Lake City', 'Cedar City']);
    expect(region).toMatchObject({ id: 'PACE', operator: 'PacifiCorp', utility: 'Rocky Mountain Power', eiaCode: 'PACE' });
    expect(region.evidenceUrls.length).toBeGreaterThanOrEqual(1);
    expect(disclaimer).toMatch(/illustrative locations.*not Torus installations.*verified hardware/i);
    expect(sites[0].mapping.evidence[0].url).not.toBe(sites[1].mapping.evidence[0].url);
    for (const site of sites) {
      expect(site.mapping.evidence[0].claim).toContain(site.city);
      expect(site).toMatchObject({ state: 'UT', regionId: 'PACE', illustrative: true, torusInstallation: false, mapping: { utility: 'Rocky Mountain Power', balancingAuthority: 'PACE' } });
      expect(site.lat).toBeGreaterThanOrEqual(37); expect(site.lat).toBeLessThanOrEqual(42);
      expect(site.lon).toBeGreaterThanOrEqual(-114.05); expect(site.lon).toBeLessThanOrEqual(-109.05);
      expect(site.mapping.evidence.length).toBeGreaterThanOrEqual(1);
      for (const evidence of site.mapping.evidence) {
        expect(evidence.url).toMatch(/^https:\/\/www.rockymountainpower.net\//);
        expect(evidence.claim.length).toBeGreaterThan(10); expect(evidence.checkedAt).toBe('2026-10-27');
      }
    }
  });
  it('returns real regional context for an interior day without network access', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network forbidden'); });
    const actual = snapshotGrid().read('PACE', { startAt: '2025-08-01T00:00:00Z', endAt: '2025-08-02T00:00:00Z' });
    expect(actual.observations).toHaveLength(96);
    expect(actual.forecast).toEqual({});
    for (const o of actual.observations) {
      expect(o.value).not.toBeNull(); expect(o.simulated).toBe(false); expect(o.source).toContain('EIA-930 PACE');
    }
  });
});
