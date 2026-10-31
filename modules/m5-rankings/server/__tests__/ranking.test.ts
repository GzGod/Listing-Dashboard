import { describe, it, expect } from 'vitest';
import { computeRanking } from '../ranking.js';
import { competitionRank } from '@app/shared';
import { resolveMembers, type MemberRec, type SnapshotRec } from '../repository.js';

const s = (projectId: number, day: string, adjustedTotal: number, trackId = 1, trackRank: number | null = null): SnapshotRec => ({ projectId, day, adjustedTotal, trackId, trackRank });
const m = (...ids: number[]): MemberRec[] => ids.map((projectId) => ({ projectId, source: 'snapshot' }));
const run = (window: number, date: string, members: MemberRec[], snapshots: SnapshotRec[], firstDays = new Map<number, string>()) =>
  computeRanking({ window, date, members, snapshots, firstDays });

describe('competitionRank', () => {
  it('1,1,3 with ties ordered by id', () => {
    const r = competitionRank([{ id: 3, v: 5 }, { id: 1, v: 9 }, { id: 2, v: 9 }, { id: 4, v: 1 }], (x) => x.v, (x) => x.id);
    expect(r.map((x) => [x.item.id, x.rank])).toEqual([[1, 1], [2, 1], [3, 3], [4, 4]]);
  });
});

describe('computeRanking', () => {
  it('sums adjusted totals over the window only; missing days are null', () => {
    const r = run(3, '2026-10-07', m(1, 2), [s(1, '2026-10-01', 100), s(1, '2026-10-05', 1), s(1, '2026-10-07', 2), s(2, '2026-10-07', 10)]);
    expect(r.from).toBe('2026-10-05');
    expect(r.ranked.map((x) => [x.projectId, x.score])).toEqual([[2, 10], [1, 3]]);
    expect(r.ranked[1]!.daily).toEqual([1, null, 2]);
    expect(r.ranked[0]!.daily).toEqual([null, null, 10]);
  });
  it('ranks on raw (unrounded) sums', () => {
    const r = run(2, '2026-10-07', m(1, 2), [s(1, '2026-10-06', 1.004), s(1, '2026-10-07', 1.004), s(2, '2026-10-07', 2.005)]);
    // 2.008 vs 2.005: would tie at 2.01 if rounded first; raw ranking keeps them distinct
    expect(r.ranked.map((x) => `${x.rank}:${x.projectId}`)).toEqual(['1:1', '2:2']);
  });
  it('ties: competition rank 1,1,3, display by projectId', () => {
    const r = run(7, '2026-10-07', m(1, 2, 3), [s(2, '2026-10-07', 5), s(1, '2026-10-07', 5), s(3, '2026-10-07', 4)]);
    expect(r.ranked.map((x) => `${x.rank}:${x.projectId}`)).toEqual(['1:1', '1:2', '3:3']);
  });
  it('window=1 uses stored trackRank from M3', () => {
    const r = run(1, '2026-10-07', m(1, 2), [s(1, '2026-10-07', 9, 1, 2), s(2, '2026-10-07', 1, 1, 1)]);
    expect(r.ranked.map((x) => `${x.rank}:${x.projectId}`)).toEqual(['1:2', '2:1']);
  });
  it('partial coverage: ranked with coveredDays + partial flag; new project complete since first day is NOT partial', () => {
    const snaps = [s(1, '2026-10-07', 30), s(2, '2026-10-05', 10), s(2, '2026-10-07', 5), s(3, '2026-10-06', 1), s(3, '2026-10-07', 1)];
    const first = new Map([[1, '2026-09-01'], [2, '2026-09-01'], [3, '2026-10-06']]);
    const r = run(7, '2026-10-07', m(1, 2, 3), snaps, first);
    expect(r.ranked.find((x) => x.projectId === 1)).toMatchObject({ coveredDays: 1, partial: true });
    expect(r.ranked.find((x) => x.projectId === 2)).toMatchObject({ coveredDays: 2, partial: true, score: 15 });
    expect(r.ranked.find((x) => x.projectId === 3)).toMatchObject({ coveredDays: 2, expectedDays: 2, partial: false });
  });
  it('members with no rows in window -> noData', () => {
    const r = run(7, '2026-10-07', m(1, 9), [s(1, '2026-10-07', 1), s(9, '2026-09-01', 99)]);
    expect(r.noData).toEqual([9]);
    expect(r.ranked.map((x) => x.projectId)).toEqual([1]);
  });
});

describe('resolveMembers (track attribution)', () => {
  it('latest snapshot on/before date wins; current track only without any snapshot', () => {
    const latest = new Map([[1, 10], [2, 20]]); // project -> track_id of latest snapshot <= date
    const current = new Map([[1, 20], [2, 20], [3, 10], [4, 20]]);
    expect(resolveMembers(10, latest, current)).toEqual([{ projectId: 1, source: 'snapshot' }, { projectId: 3, source: 'current' }]);
    expect(resolveMembers(20, latest, current).map((x) => x.projectId)).toEqual([2, 4]); // 1 moved to 20 later but not as of date
  });
});

describe('null-track rule (rule change: no COALESCE)', () => {
  it('latest snapshot with NULL track excludes the project; projects.track_id only when no snapshot exists', () => {
    const latest = new Map<number, number | null>([[1, 5], [2, null], [3, 6]]);
    const current = new Map<number, number | null>([[1, 6], [2, 5], [3, 6], [4, 5]]);
    expect(resolveMembers(5, latest, current)).toEqual([{ projectId: 1, source: 'snapshot' }, { projectId: 4, source: 'current' }]);
    expect(resolveMembers(6, latest, current).map((x) => x.projectId)).toEqual([3]);
  });
  it('null-track days do not enter a 7d score (shown as null in daily)', () => {
    const snaps = [s(1, '2026-10-29', 10), s(1, '2026-10-30', 5), { ...s(1, '2026-10-28', 100), trackId: null }, s(2, '2026-10-30', 14)];
    const r = run(7, '2026-10-30', m(1, 2), snaps);
    const p1 = r.ranked.find((x) => x.projectId === 1)!;
    expect(p1.score).toBe(15);
    expect(p1.daily[4]).toBeNull();
    expect(r.ranked[0]!.projectId).toBe(1);
  });
  it('1d: a member whose only row that day has null track is not ranked', () => {
    const r = run(1, '2026-10-30', m(1, 2), [{ ...s(1, '2026-10-30', 50), trackId: null }, s(2, '2026-10-30', 1, 1, 1)]);
    expect(r.ranked.map((x) => x.projectId)).toEqual([2]);
  });
});

describe('manifest config is an ARRAY of ModuleConfigSpec (round 3)', async () => {
  const { m5ManifestConfig, defaultM5Config, loadM5ConfigFromBase } = await import('../../config.js');
  it('[{key, default, description}], module-prefixed, nothing public', () => {
    const c = m5ManifestConfig();
    expect(Array.isArray(c)).toBe(true);
    expect(c.find((x) => x.key === 'm5-rankings.cacheTtlSec')).toMatchObject({ default: 600, description: expect.any(String) });
    expect(c.find((x) => x.key === 'm5-rankings.projectDetailHref')?.default).toBe('/m/m6-project/{id}');
    expect(c.every((x) => x.key.startsWith('m5-rankings.') && !('public' in x) && !!x.description)).toBe(true);
    expect(defaultM5Config.projectDetailHref).toBe('/m/m6-project/{id}');
  });
  it('reader picks values by key', async () => {
    const vals: Record<string, unknown> = { 'm5-rankings.cacheTtlSec': 30, 'm5-rankings.projectDetailHref': '/x/{id}' };
    const cfg = (await loadM5ConfigFromBase({ get: async (k, fb) => (k in vals ? vals[k] : fb) as never })).get();
    expect(cfg.cacheTtlSec).toBe(30); expect(cfg.projectDetailHref).toBe('/x/{id}');
  });
});
