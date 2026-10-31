/**
 * TEST/HARNESS ONLY (duplicated per module on purpose; no cross-module import). Deterministic in-memory stand-in for the
 * read-only core tables, base column names (snake_case) + numeric ids. Never imported by module production code.
 */
import { getMockDb, type MockDb } from './mock-db.js';
import { resolveMembers, type RankingsRepository, type TrackRec } from '../server/index.js';

export class MockRankingsRepository implements RankingsRepository {
  constructor(private db: MockDb = getMockDb()) {}
  private trackRec = (t: MockDb['tracks'][number]): TrackRec => ({ id: t.id, name: t.name, parentId: t.parent_id });
  async listTracks() { return this.db.tracks.map(this.trackRec); }
  async getTrack(id: number) { const t = this.db.tracks.find((x) => x.id === id); return t ? this.trackRec(t) : null; }
  async getMembers(trackId: number, asOf: string) {
    const latest = new Map<number, { day: string; track: number | null }>();
    for (const s of this.db.buzz_snapshots) {
      if (s.day > asOf) continue;
      const cur = latest.get(s.project_id);
      if (!cur || s.day > cur.day) latest.set(s.project_id, { day: s.day, track: s.track_id });
    }
    return resolveMembers(trackId, new Map([...latest].map(([k, v]) => [k, v.track])), new Map(this.db.projects.map((p) => [p.id, p.track_id])));
  }
  async getSnapshots(projectIds: number[], from: string, to: string) {
    const ids = new Set(projectIds);
    return this.db.buzz_snapshots.filter((s) => ids.has(s.project_id) && s.day >= from && s.day <= to)
      .map((s) => ({ projectId: s.project_id, day: s.day, adjustedTotal: s.adjusted_total, trackId: s.track_id, trackRank: s.track_rank }));
  }
  async getFirstSnapshotDays(projectIds: number[]) {
    const ids = new Set(projectIds); const m = new Map<number, string>();
    for (const s of this.db.buzz_snapshots) if (ids.has(s.project_id) && (!m.has(s.project_id) || s.day < m.get(s.project_id)!)) m.set(s.project_id, s.day);
    return m;
  }
  async getProjects(ids: number[]) {
    const s = new Set(ids);
    return this.db.projects.filter((p) => s.has(p.id)).map((p) => ({ id: p.id, name: p.name, symbol: p.symbol, logoUrl: p.logo_url }));
  }
}


