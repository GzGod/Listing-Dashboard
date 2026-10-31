import { addDays, dayRange } from '../lib/day.js';
import { competitionRank } from '@app/shared';
import type { MemberRec, SnapshotRec } from './repository.js';

export interface RankInput {
  window: number; date: string;
  /** already-resolved members (see RankingsRepository.getMembers) */
  members: MemberRec[];
  /** snapshots of the members covering [date-window+1, date] (extra rows are ignored) */
  snapshots: SnapshotRec[];
  /** first-ever snapshot day per project (partial-coverage rule) */
  firstDays: Map<number, string>;
}
export interface RankedRow {
  rank: number; projectId: number; score: number; coveredDays: number; expectedDays: number; partial: boolean; daily: (number | null)[];
}
export interface RankOutput { from: string; ranked: RankedRow[]; noData: number[] }

/**
 * Pure aggregation.
 * - score = Σ adjusted_total over days with a snapshot whose track_id IS NOT NULL (raw, unrounded); missing or null-track day -> null in daily[].
 * - members with no rows in the window -> noData (not ranked).
 * - window = 1: rank = stored buzz_snapshots.track_rank written by M3 (no recompute); falls back to computing
 *   only if a stored rank is missing. window > 1: computed here.
 * - standard competition ranking on RAW scores: equal scores share a rank, next rank skips (1,1,3);
 *   display order among ties = projectId asc.
 * - partial rule: expectedDays = days in [max(from, firstSnapshotDay), date]; partial = coveredDays < expectedDays.
 *   So a brand-new project with complete data since its first snapshot is NOT partial.
 */
export function computeRanking(input: RankInput): RankOutput {
  const { window, date } = input;
  const from = addDays(date, -(window - 1));
  const days = dayRange(from, date);
  const idx = new Map(days.map((d, i) => [d, i]));
  const memberSet = new Set(input.members.map((m) => m.projectId));
  const byProject = new Map<number, (number | null)[]>();
  const storedRank = new Map<number, number | null>();
  for (const s of input.snapshots) {
    const i = idx.get(s.day);
    // null-track day (M3 wrote the row with track/rank NULL): does NOT enter the ranking; shows as null in daily[]
    if (i === undefined || !memberSet.has(s.projectId) || s.trackId === null) continue;
    let arr = byProject.get(s.projectId);
    if (!arr) byProject.set(s.projectId, (arr = new Array<number | null>(days.length).fill(null)));
    arr[i] = (arr[i] ?? 0) + s.adjustedTotal;
    if (s.day === date) storedRank.set(s.projectId, s.trackRank);
  }
  const rows: Omit<RankedRow, 'rank'>[] = [];
  const noData: number[] = [];
  for (const pid of memberSet) {
    const daily = byProject.get(pid);
    if (!daily) { noData.push(pid); continue; }
    let score = 0; let covered = 0;
    for (const v of daily) if (v !== null) { score += v; covered++; }
    const first = input.firstDays.get(pid) ?? from;
    const start = first > from ? first : from;
    const expectedDays = start > date ? 0 : dayRange(start, date).length;
    rows.push({ projectId: pid, score, coveredDays: covered, expectedDays, partial: covered < expectedDays, daily });
  }
  noData.sort((a, b) => a - b);
  const useStored = window === 1 && rows.every((r) => storedRank.get(r.projectId) != null);
  const ranked: RankedRow[] = useStored
    ? rows.map((r) => ({ rank: storedRank.get(r.projectId)!, ...r })).sort((a, b) => a.rank - b.rank || a.projectId - b.projectId)
    : competitionRank(rows, (r) => r.score, (r) => r.projectId).map(({ item, rank }) => ({ rank, ...item }));
  return { from, ranked, noData };
}
