/**
 * TEST/HARNESS ONLY (duplicated per module on purpose; no cross-module import). Deterministic in-memory stand-in for the
 * read-only core tables, base column names (snake_case) + numeric ids. Never imported by module production code.
 */
import { getMockDb, type MockDb } from './mock-db.js';
import { mapListingRows, type ProjectRepository, type BuzzDay, type MarketDay, type PostRec, type PostCursor, type UnknownStageLogger } from '../server/index.js';

export class MockProjectRepository implements ProjectRepository {
  constructor(private db: MockDb = getMockDb(), private logUnknownStage: UnknownStageLogger = () => {}) {}
  async getProject(id: number) {
    const p = this.db.projects.find((x) => x.id === id);
    if (!p) return null;
    const { name, symbol, track_id, ...profile } = p;
    delete (profile as { id?: unknown }).id;
    return { id, name, symbol, trackId: track_id, profile };
  }
  async getTrack(id: number) { const t = this.db.tracks.find((x) => x.id === id); return t ? { id: t.id, name: t.name, parentId: t.parent_id } : null; }
  async getContracts(projectId: number) { return this.db.project_contracts.filter((c) => c.project_id === projectId).map(({ chain, address }) => ({ chain, address })); }
  private buzz = (r: MockDb['buzz_snapshots'][number]): BuzzDay => ({ day: r.day, adjustedTotal: r.adjusted_total, trackRank: r.track_rank,
    kolPostCount: r.kol_post_count, coreExposureCount: r.core_exposure_count, heatScore: r.heat_score });
  private market = (r: MockDb['project_daily'][number]): MarketDay => ({ day: r.day, priceUsd: r.price_usd, totalSpotVolumeUsd: r.total_spot_volume_usd, volumeTrackRank: r.volume_track_rank });
  async getLatestBuzz(projectId: number, asOf: string) {
    const rows = this.db.buzz_snapshots.filter((r) => r.project_id === projectId && r.day <= asOf).sort((a, b) => b.day.localeCompare(a.day));
    return rows[0] ? this.buzz(rows[0]) : null;
  }
  async getLatestMarket(projectId: number, asOf: string, col: 'price' | 'volume') {
    const rows = this.db.project_daily.filter((r) => r.project_id === projectId && r.day <= asOf && (col === 'price' ? r.price_usd : r.total_spot_volume_usd) !== null)
      .sort((a, b) => b.day.localeCompare(a.day));
    return rows[0] ? this.market(rows[0]) : null;
  }
  async getExchangeVolumes(projectId: number, day: string) {
    const ex = new Map(this.db.exchanges.map((e) => [e.id, e.name]));
    return this.db.volume_snapshots.filter((v) => v.project_id === projectId && v.day === day)
      .map((v) => ({ exchange: ex.get(v.exchange_id) ?? String(v.exchange_id), volumeUsd: v.spot_volume_usd_24h }));
  }
  async getBuzzRange(projectId: number, from: string, to: string) { return this.db.buzz_snapshots.filter((r) => r.project_id === projectId && r.day >= from && r.day <= to).map(this.buzz); }
  async getMarketRange(projectId: number, from: string, to: string) { return this.db.project_daily.filter((r) => r.project_id === projectId && r.day >= from && r.day <= to).map(this.market); }
  async getListingEvents(projectId: number, from: string, to: string) {
    const ex = new Map(this.db.exchanges.map((e) => [e.id, e.name]));
    const rows = this.db.listing_events.filter((r) => r.project_id === projectId && r.day >= from && r.day <= to)
      .map((r) => ({ id: r.id, exchange: ex.get(r.exchange_id) ?? String(r.exchange_id), stage: r.stage as string, day: r.day, pair: r.pair, announcementUrl: r.announcement_url }));
    return mapListingRows(rows, this.logUnknownStage);
  }
  async getConfirmedPosts(projectId: number, fromIso: string, after: PostCursor | null, limit: number) {
    const posts = new Map(this.db.posts.map((p) => [p.id, p]));
    const people = new Map(this.db.people.map((p) => [p.id, p]));
    const out: PostRec[] = [];
    for (const m of this.db.post_mentions) {
      if (m.project_id !== projectId || m.status !== 'confirmed') continue;
      const p = posts.get(m.post_id);
      if (!p || !p.url || p.posted_at < fromIso) continue;
      // emulates SQL row comparison (posted_at, id) < ($1, $2)
      if (after && !(p.posted_at < after.postedAt || (p.posted_at === after.postedAt && p.id < after.postId))) continue;
      const a = people.get(p.person_id);
      if (!a) continue;
      out.push({ postId: p.id, url: p.url, platform: p.platform, postedAt: p.posted_at, views: p.views, bookmarks: p.bookmarks, matchMethod: m.match_method,
        author: { personId: a.id, name: a.display_name, handle: a.handle, kolTier: a.kol_tier, tags: a.tags } });
    }
    out.sort((x, y) => (x.postedAt === y.postedAt ? y.postId - x.postId : x.postedAt < y.postedAt ? 1 : -1));
    return out.slice(0, limit);
  }
}

