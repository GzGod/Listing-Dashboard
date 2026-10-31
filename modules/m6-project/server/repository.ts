import * as q from './queries.js';
import type { CoreDb } from './queries.js';
export type { CoreDb } from './queries.js';
import type { ListingStage } from '@app/shared';
import type { ApiListingStage } from '../schema/index.js';

/**
 * Read-only access for M6. Domain records (camelCase); DB column mapping lives only in the implementations.
 * Buzz values come from buzz_snapshots (adjusted_total already merges buzz_adjustments, never read here);
 * price/volume from project_daily; per-exchange volume from volume_snapshots ⨝ exchanges.
 */
import type { ProjectBase, TrackRec, BuzzDay, MarketDay, ExchangeVolume, ListingRec, PostRec, PostCursor } from './types.js';
export type { ProjectBase, TrackRec, BuzzDay, MarketDay, ExchangeVolume, ListingRec, PostRec, PostCursor } from './types.js';

export interface ProjectRepository {
  getProject(id: number): Promise<ProjectBase | null>;
  getTrack(id: number): Promise<TrackRec | null>;
  getContracts(projectId: number): Promise<{ chain: string; address: string }[]>;
  /** latest buzz_snapshot with day <= asOf */
  getLatestBuzz(projectId: number, asOf: string): Promise<BuzzDay | null>;
  /** latest project_daily with day <= asOf and the given column NOT NULL */
  getLatestMarket(projectId: number, asOf: string, col: 'price' | 'volume'): Promise<MarketDay | null>;
  getExchangeVolumes(projectId: number, day: string): Promise<ExchangeVolume[]>;
  getBuzzRange(projectId: number, from: string, to: string): Promise<BuzzDay[]>;
  getMarketRange(projectId: number, from: string, to: string): Promise<MarketDay[]>;
  getListingEvents(projectId: number, from: string, to: string): Promise<ListingRec[]>;
  /** post_mentions.status = 'confirmed' only; posted_at >= fromIso; ORDER BY posted_at DESC, post_id DESC; (posted_at, post_id) < cursor */
  getConfirmedPosts(projectId: number, fromIso: string, after: PostCursor | null, limit: number): Promise<PostRec[]>;
}

/** DB enum (base `ListingStage`: preannounce|spot|perp, schema.prisma listing_events.stage) -> API `ApiListingStage` */
const STAGE_FROM_DB: Record<ListingStage, ApiListingStage> = { preannounce: 'teaser', spot: 'spot', perp: 'perp' };
export type UnknownStageLogger = (info: { listingEventId: number; stage: string }) => void;
/** DB stage -> API stage. Unknown stages are LOGGED and SKIPPED (never defaulted). */
export function mapListingRows<R extends { id: number; stage: string }>(rows: R[], log: UnknownStageLogger): (Omit<R, 'stage'> & { stage: ApiListingStage })[] {
  const out: (Omit<R, 'stage'> & { stage: ApiListingStage })[] = [];
  for (const r of rows) {
    const stage = Object.prototype.hasOwnProperty.call(STAGE_FROM_DB, r.stage) ? STAGE_FROM_DB[r.stage as ListingStage] : undefined;
    if (!stage) { log({ listingEventId: r.id, stage: r.stage }); continue; }
    out.push({ ...r, stage });
  }
  return out;
}

/**
 * Postgres implementation over the base's ctx.db.core. All SQL lives in ./queries.ts (template-string vs Prisma.sql form
 * is pending the base's decision; only that file changes). Real-PG check: __tests__/pg.int.test.ts (needs PG_TEST_URL).
 */
export class PgProjectRepository implements ProjectRepository {
  constructor(private db: CoreDb, private logUnknownStage: UnknownStageLogger = () => {}) {}
  async getProject(id: number) {
    const p = (await q.getProject(this.db, id))[0]; if (!p) return null;
    const { name, symbol, track_id, ...profile } = p;
    delete (profile as { id?: unknown }).id;
    return { id, name, symbol, trackId: track_id, profile };
  }
  async getTrack(id: number) { return (await q.getTrack(this.db, id))[0] ?? null; }
  getContracts(projectId: number) { return q.getContracts(this.db, projectId); }
  async getLatestBuzz(projectId: number, asOf: string) { return (await q.getLatestBuzz(this.db, projectId, asOf))[0] ?? null; }
  async getLatestMarket(projectId: number, asOf: string, col: 'price' | 'volume') {
    return (await (col === 'price' ? q.getLatestPrice : q.getLatestVolume)(this.db, projectId, asOf))[0] ?? null;
  }
  getExchangeVolumes(projectId: number, day: string) { return q.getExchangeVolumes(this.db, projectId, day); }
  getBuzzRange(projectId: number, from: string, to: string) { return q.getBuzzRange(this.db, projectId, from, to); }
  getMarketRange(projectId: number, from: string, to: string) { return q.getMarketRange(this.db, projectId, from, to); }
  async getListingEvents(projectId: number, from: string, to: string) {
    return mapListingRows(await q.getListingEvents(this.db, projectId, from, to), this.logUnknownStage);
  }
  async getConfirmedPosts(projectId: number, fromIso: string, after: PostCursor | null, limit: number) {
    const rows = await q.getConfirmedPosts(this.db, projectId, fromIso, after, limit);
    return rows.map(({ personId, name, handle, kolTier, tags, ...r }) => ({ ...r, author: { personId, name, handle, kolTier, tags } }));
  }
}
