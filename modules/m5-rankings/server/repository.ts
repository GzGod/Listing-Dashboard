import * as q from './queries.js';
import type { CoreDb } from './queries.js';
export type { CoreDb } from './queries.js';

/**
 * Read-only access to core tables for M5. Domain records below; DB column mapping lives ONLY in the repository
 * implementations (mock + Pg). Score source: buzz_snapshots.adjusted_total (already merges buzz_adjustments,
 * which we never read).
 */
import type { TrackRec, ProjectRec, SnapshotRec, MemberRec } from './types.js';
export type { TrackRec, ProjectRec, SnapshotRec, MemberRec } from './types.js';

export interface RankingsRepository {
  listTracks(): Promise<TrackRec[]>;
  getTrack(id: number): Promise<TrackRec | null>;
  /**
   * Members of `trackId` as of `asOf` (= window END date for 7d/30d): the latest buzz_snapshot with day <= asOf decides
   * (snapshot on date -> latest before date); if its track_id IS NULL the project is excluded (no COALESCE).
   * projects.track_id is used ONLY when there is no snapshot at all on/before asOf.
   */
  getMembers(trackId: number, asOf: string): Promise<MemberRec[]>;
  /** buzz_snapshots for the given projects only, from <= day <= to */
  getSnapshots(projectIds: number[], from: string, to: string): Promise<SnapshotRec[]>;
  /** MIN(day) of buzz_snapshots per project (used for the partial-coverage rule) */
  getFirstSnapshotDays(projectIds: number[]): Promise<Map<number, string>>;
  getProjects(ids: number[]): Promise<ProjectRec[]>;
}

/** Pure membership resolution; the test/harness mock uses it, the Pg repo does the same in SQL. */
export function resolveMembers(trackId: number, latestTrackByProject: Map<number, number | null>, currentTrackByProject: Map<number, number | null>): MemberRec[] {
  const out: MemberRec[] = [];
  // latest snapshot on/before asOf decides; a NULL track there means "exists, no track" -> excluded (never skipped over)
  for (const [pid, t] of latestTrackByProject) if (t !== null && t === trackId) out.push({ projectId: pid, source: 'snapshot' });
  // projects.track_id ONLY when the project has no snapshot at all on/before asOf
  for (const [pid, t] of currentTrackByProject) if (t === trackId && !latestTrackByProject.has(pid)) out.push({ projectId: pid, source: 'current' });
  return out.sort((a, b) => a.projectId - b.projectId);
}

/**
 * Postgres implementation over the base's ctx.db.core. All SQL lives in ./queries.ts (the only file to touch if the base
 * switches between `$queryRaw` template strings and Prisma.sql fragments — still pending the base's decision).
 * NOT run against PG in unit tests; see __tests__/pg.int.test.ts for the real-PG check (needs PG_TEST_URL).
 */
export class PgRankingsRepository implements RankingsRepository {
  constructor(private db: CoreDb) {}
  listTracks() { return q.listTracks(this.db); }
  async getTrack(id: number) { return (await q.getTrack(this.db, id))[0] ?? null; }
  getMembers(trackId: number, asOf: string) { return q.getMembers(this.db, trackId, asOf); }
  async getSnapshots(projectIds: number[], from: string, to: string) { return projectIds.length ? q.getSnapshots(this.db, projectIds, from, to) : []; }
  async getFirstSnapshotDays(projectIds: number[]) {
    if (!projectIds.length) return new Map<number, string>();
    return new Map((await q.getFirstSnapshotDays(this.db, projectIds)).map((r) => [r.projectId, r.day]));
  }
  async getProjects(ids: number[]) { return ids.length ? q.getProjects(this.db, ids) : []; }
}
