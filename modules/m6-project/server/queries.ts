/**
 * ALL raw SQL of m6-project, isolated here. Written as `ctx.db.core.$queryRaw` TEMPLATE STRINGS (base rule: template form
 * only, read-only, all values bound). Whether the base later prefers Prisma.sql fragments is pending — only this file
 * would change. No string concatenation, no unsafe/execute raw. Column names per base schema.prisma.
 *
 * posts.posted_at is `timestamp(3)` WITHOUT time zone holding UTC wall time. We never apply AT TIME ZONE / ::timestamptz
 * (both depend on the session TimeZone); we print it with to_char(...MS) + literal "Z" and compare with ::timestamp
 * (a trailing Z in the input is ignored by ::timestamp), so results are identical under any session TimeZone.
 */
import type { ProjectProfileColumns } from './fundamentals-mapping.js';
import type { BuzzDay, ExchangeVolume, ListingRec, MarketDay, PostCursor, PostRec, TrackRec } from './types.js';

/** Minimal shape of the base `ctx.db.core` (scoped PrismaClient) that we use; PrismaClient satisfies it. */
export interface CoreDb { $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> }

type ProjectRow = ProjectProfileColumns & { id: number; name: string; symbol: string; track_id: number | null };
export const getProject = (db: CoreDb, id: number) => db.$queryRaw<ProjectRow[]>`
  SELECT id, name, symbol, track_id, logo_url, website_url, x_handle, docs_url,
         users_count, to_char(users_as_of, 'YYYY-MM-DD') AS users_as_of, users_source,
         revenue_usd::float8 AS revenue_usd, revenue_period, to_char(revenue_as_of, 'YYYY-MM-DD') AS revenue_as_of, revenue_source,
         fundamentals, team, longge_rating, to_char(longge_rated_at, 'YYYY-MM-DD') AS longge_rated_at
  FROM projects WHERE id = ${id}`;

export const getTrack = (db: CoreDb, id: number) =>
  db.$queryRaw<TrackRec[]>`SELECT id, name, parent_id AS "parentId" FROM tracks WHERE id = ${id}`;

export const getContracts = (db: CoreDb, projectId: number) =>
  db.$queryRaw<{ chain: string; address: string }[]>`SELECT chain, address FROM project_contracts WHERE project_id = ${projectId} ORDER BY id`;

export const getLatestBuzz = (db: CoreDb, projectId: number, asOf: string) => db.$queryRaw<BuzzDay[]>`
  SELECT to_char(day, 'YYYY-MM-DD') AS day, adjusted_total AS "adjustedTotal", track_rank AS "trackRank",
         kol_post_count AS "kolPostCount", core_exposure_count AS "coreExposureCount", heat_score AS "heatScore"
  FROM buzz_snapshots WHERE project_id = ${projectId} AND day <= ${asOf}::date ORDER BY day DESC LIMIT 1`;

export const getBuzzRange = (db: CoreDb, projectId: number, from: string, to: string) => db.$queryRaw<BuzzDay[]>`
  SELECT to_char(day, 'YYYY-MM-DD') AS day, adjusted_total AS "adjustedTotal", track_rank AS "trackRank",
         kol_post_count AS "kolPostCount", core_exposure_count AS "coreExposureCount", heat_score AS "heatScore"
  FROM buzz_snapshots WHERE project_id = ${projectId} AND day BETWEEN ${from}::date AND ${to}::date`;

export const getLatestPrice = (db: CoreDb, projectId: number, asOf: string) => db.$queryRaw<MarketDay[]>`
  SELECT to_char(day, 'YYYY-MM-DD') AS day, price_usd AS "priceUsd", total_spot_volume_usd AS "totalSpotVolumeUsd", volume_track_rank AS "volumeTrackRank"
  FROM project_daily WHERE project_id = ${projectId} AND day <= ${asOf}::date AND price_usd IS NOT NULL ORDER BY day DESC LIMIT 1`;

export const getLatestVolume = (db: CoreDb, projectId: number, asOf: string) => db.$queryRaw<MarketDay[]>`
  SELECT to_char(day, 'YYYY-MM-DD') AS day, price_usd AS "priceUsd", total_spot_volume_usd AS "totalSpotVolumeUsd", volume_track_rank AS "volumeTrackRank"
  FROM project_daily WHERE project_id = ${projectId} AND day <= ${asOf}::date AND total_spot_volume_usd IS NOT NULL ORDER BY day DESC LIMIT 1`;

export const getMarketRange = (db: CoreDb, projectId: number, from: string, to: string) => db.$queryRaw<MarketDay[]>`
  SELECT to_char(day, 'YYYY-MM-DD') AS day, price_usd AS "priceUsd", total_spot_volume_usd AS "totalSpotVolumeUsd", volume_track_rank AS "volumeTrackRank"
  FROM project_daily WHERE project_id = ${projectId} AND day BETWEEN ${from}::date AND ${to}::date`;

export const getExchangeVolumes = (db: CoreDb, projectId: number, day: string) => db.$queryRaw<ExchangeVolume[]>`
  SELECT e.name AS exchange, v.spot_volume_usd_24h AS "volumeUsd" FROM volume_snapshots v JOIN exchanges e ON e.id = v.exchange_id
  WHERE v.project_id = ${projectId} AND v.day = ${day}::date ORDER BY v.spot_volume_usd_24h DESC`;

export const getListingEvents = (db: CoreDb, projectId: number, from: string, to: string) => db.$queryRaw<(Omit<ListingRec, 'stage'> & { stage: string })[]>`
  SELECT l.id, e.name AS exchange, l.stage, to_char(l.day, 'YYYY-MM-DD') AS day, l.pair, l.announcement_url AS "announcementUrl"
  FROM listing_events l JOIN exchanges e ON e.id = l.exchange_id
  WHERE l.project_id = ${projectId} AND l.day BETWEEN ${from}::date AND ${to}::date ORDER BY l.day, l.id`;

export type PostRow = Omit<PostRec, 'author'> & { personId: number; name: string; handle: string; kolTier: string | null; tags: string[] };
/** keyset page: status='confirmed' only; ORDER BY posted_at DESC, id DESC; (posted_at, id) < cursor when a cursor is given */
export const getConfirmedPosts = (db: CoreDb, projectId: number, fromIso: string, after: PostCursor | null, limit: number) => db.$queryRaw<PostRow[]>`
  SELECT p.id AS "postId", p.url, pl.name AS platform, to_char(p.posted_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "postedAt",
         p.views, p.bookmarks, m.match_method AS "matchMethod",
         pe.id AS "personId", pe.display_name AS name, pe.handle, pe.kol_tier AS "kolTier",
         COALESCE((SELECT array_agg(t.tag ORDER BY t.tag) FROM person_tags t WHERE t.person_id = pe.id), '{}') AS tags
  FROM post_mentions m JOIN posts p ON p.id = m.post_id JOIN people pe ON pe.id = p.person_id JOIN platforms pl ON pl.id = p.platform_id
  WHERE m.project_id = ${projectId} AND m.status = 'confirmed' AND p.url IS NOT NULL AND p.posted_at >= ${fromIso}::timestamp
    AND (${after === null}::boolean OR (p.posted_at, p.id) < (${after?.postedAt ?? null}::timestamp, ${after?.postId ?? null}::int))
  ORDER BY p.posted_at DESC, p.id DESC LIMIT ${limit}`;
