import { describe, it, expect } from 'vitest';
import { alignSeries, decodeCursor, encodeCursor } from '../series.js';
import { mapFundamentals, mapLinks, type ProjectProfileColumns } from '../fundamentals-mapping.js';
import type { BuzzDay, MarketDay } from '../repository.js';

const bz = (day: string, v: number, rank: number | null = 1): BuzzDay => ({ day, adjustedTotal: v, trackRank: rank, kolPostCount: 2, coreExposureCount: 3, heatScore: 4 });
const mk = (day: string, priceUsd: number | null, vol: number | null): MarketDay => ({ day, priceUsd, totalSpotVolumeUsd: vol, volumeTrackRank: vol === null ? null : 2 });

describe('alignSeries', () => {
  it('one point per day; missing day and null columns stay null (never 0), no interpolation', () => {
    const pts = alignSeries('2026-10-01', '2026-10-04', [bz('2026-10-01', 10, 3), bz('2026-10-03', 30)], [mk('2026-10-02', 1.5, 100), mk('2026-10-03', null, 50), mk('2026-09-01', 9, 9)]);
    expect(pts.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(pts.map((p) => p.buzzScore)).toEqual([10, null, 30, null]);
    expect(pts.map((p) => p.buzzRankInTrack)).toEqual([3, null, 1, null]);
    expect(pts.map((p) => p.priceUsd)).toEqual([null, 1.5, null, null]);
    expect(pts.map((p) => p.spotVolumeUsd24h)).toEqual([null, 100, 50, null]);
  });
  it('cursor roundtrip and rejection', () => {
    expect(decodeCursor(encodeCursor({ postedAt: '2026-10-01T00:00:00.000Z', postId: 7 }))).toEqual({ postedAt: '2026-10-01T00:00:00.000Z', postId: 7 });
    expect(decodeCursor('garbage!!')).toBeNull();
    expect(decodeCursor(Buffer.from('2026-10-01T00:00:00Z|x').toString('base64url'))).toBeNull();
  });
});

const cols = (o: Partial<ProjectProfileColumns> = {}): ProjectProfileColumns => ({ logo_url: null, website_url: null, x_handle: null, docs_url: null,
  users_count: null, users_as_of: null, users_source: null, revenue_usd: null, revenue_period: null, revenue_as_of: null, revenue_source: null,
  fundamentals: null, team: null, longge_rating: null, longge_rated_at: null, ...o });

describe('fundamentals-mapping', () => {
  it('maps dedicated columns + JSON', () => {
    const f = mapFundamentals(1, cols({ users_count: 5, users_as_of: '2026-10-01', users_source: 'Dune', revenue_usd: 9, revenue_period: '30d', revenue_as_of: '2026-10-02', revenue_source: null,
      fundamentals: { capTable: [{ holder: '团队', pct: 20, note: null }] }, team: [{ name: 'A', role: 'CEO', bio: null, url: null }], longge_rating: 'A', longge_rated_at: '2026-10-03' }));
    expect(f).toMatchObject({ userCount: { value: 5, asOf: '2026-10-01', source: 'Dune' }, revenue: { valueUsd: 9, source: null }, rating: { grade: 'A' } });
    expect(f.capTable).toHaveLength(1); expect(f.team).toHaveLength(1);
    expect(mapLinks(cols({ x_handle: '@foo' })).x).toBe('https://x.com/foo');
  });
  it('invalid JSON -> missing + logged; null columns -> null', () => {
    const logs: string[] = [];
    const f = mapFundamentals(11, cols({ fundamentals: { capTable: 'oops' }, team: [{ nope: 1 }] }), (m) => logs.push(m));
    expect(f.capTable).toEqual([]); expect(f.team).toEqual([]); expect(logs).toHaveLength(2);
    expect(f.userCount).toBeNull(); expect(f.revenue).toBeNull(); expect(f.rating).toBeNull();
  });
});
