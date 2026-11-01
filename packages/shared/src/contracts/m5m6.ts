/**
 * ⚠️ 占位契约（PLACEHOLDER）—— 归 M5M6 模块所有，底座不实现这些接口。
 * 按 M5M6 草稿（/workspace/shangbi-kanban/packages/shared）改写：查询参数用工厂函数，取值范围来自配置中心。
 * M5M6 定稿后直接替换本文件（packages/shared/src/contracts/m5m6.ts）；底座其他代码不依赖这里。用法：import { m5m6 } from "@app/shared"。
 */
import { z } from "zod";
import { isValidDay } from "../date.js";
export { isValidDay }; // 兼容旧写法 m5m6.isValidDay，实现在 ../date.ts

// ---------- m5-rankings: GET /rankings ----------

export interface RankingsParamRules { windows: readonly number[]; defaultWindow: number }

export function makeRankingsQuerySchema(rules: RankingsParamRules) {
  return z.object({
    track: z.coerce.number({ invalid_type_error: 'track 必须是正整数' }).int().positive('track（细分赛道 id）必填，正整数'),
    window: z.coerce.number().int().refine((n) => rules.windows.includes(n), `window 只能是 ${rules.windows.join('|')}`).default(rules.defaultWindow),
    date: z.string().refine(isValidDay, 'date 格式应为 YYYY-MM-DD').optional(),
  });
}
export type RankingsQuery = z.infer<ReturnType<typeof makeRankingsQuerySchema>>;

export const rankingItemSchema = z.object({
  rank: z.number().int(), prevRank: z.number().int().nullable(), rankDelta: z.number().int().nullable(),
  projectId: z.number().int(), name: z.string(), symbol: z.string(), logoUrl: z.string().nullable(),
  /** rounded to config.scoreDecimals on output; ranking used raw sums */
  score: z.number(), coveredDays: z.number().int(),
  /** see README partial rule */
  partial: z.boolean(),
  /** one entry per window day; null = no snapshot that day */
  daily: z.array(z.number().nullable()),
  /** 详情页链接（前台路由） */
  detailHref: z.string(),
});
export const rankingsResponseSchema = z.object({
  track: z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().nullable() }),
  window: z.number(), date: z.string(), from: z.string(),
  items: z.array(rankingItemSchema),
  noData: z.array(z.object({ projectId: z.number().int(), name: z.string(), symbol: z.string(), detailHref: z.string() })),
});
export type RankingItem = z.infer<typeof rankingItemSchema>;
export type RankingsResponse = z.infer<typeof rankingsResponseSchema>;

/** Helper endpoint GET /rankings/tracks (not in approved spec; feeds the tabs). */
export const tracksResponseSchema = z.object({
  tracks: z.array(z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().nullable() })),
});
export type TracksResponse = z.infer<typeof tracksResponseSchema>;

// ---------- m6-project: GET /projects/:id, /series, /posts ----------

export interface ProjectParamRules {
  ranges: Readonly<Record<string, number>>; defaultSeriesRange: string; defaultPostsRange: string;
  postsPageSize: number; postsMaxPageSize: number;
}
const rangeOf = (r: ProjectParamRules, def: string) =>
  z.string().refine((k) => Object.prototype.hasOwnProperty.call(r.ranges, k), `range 只能是 ${Object.keys(r.ranges).join('|')}`).default(def);

export const projectParamsSchema = z.object({
  id: z.string().regex(/^[1-9]\d{0,9}$/, 'id 必须是正整数').transform(Number),
});
export const makeSeriesQuerySchema = (r: ProjectParamRules) => z.object({ range: rangeOf(r, r.defaultSeriesRange) });
export const makePostsQuerySchema = (r: ProjectParamRules) => z.object({
  range: rangeOf(r, r.defaultPostsRange),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(r.postsMaxPageSize).default(r.postsPageSize),
});

const sourced = { asOf: z.string(), source: z.string().nullable() };
export const projectDetailSchema = z.object({
  id: z.number().int(), name: z.string(), symbol: z.string(), logoUrl: z.string().nullable(),
  track: z.object({ id: z.number().int(), name: z.string(), parent: z.object({ id: z.number().int(), name: z.string() }).nullable() }).nullable(),
  contracts: z.array(z.object({ chain: z.string(), address: z.string() })),
  links: z.object({ website: z.string().nullable(), x: z.string().nullable(), docs: z.string().nullable() }),
  fundamentals: z.object({
    capTable: z.array(z.object({ holder: z.string(), pct: z.number(), note: z.string().nullable() })),
    team: z.array(z.object({ name: z.string(), role: z.string(), bio: z.string().nullable(), url: z.string().nullable() })),
    rating: z.object({ grade: z.string(), ratedAt: z.string().nullable() }).nullable(),
    userCount: z.object({ value: z.number(), ...sourced }).nullable(),
    revenue: z.object({ valueUsd: z.number(), period: z.string().nullable(), ...sourced }).nullable(),
  }),
  /** latest buzz snapshot with day <= latest complete UTC day; `date` = that snapshot's day */
  buzzBreakdown: z.object({ date: z.string(), kolPostCount: z.number().nullable(), coreExposureCount: z.number().nullable(), heatScore: z.number().nullable(), adjustedScore: z.number(), rankInTrack: z.number().nullable() }).nullable(),
  /** latest project_daily row with volume; rank = stored same-day same-sub-track rank */
  volume: z.object({ date: z.string(), spotVolumeUsd24h: z.number(), rankInTrack: z.number().nullable(), byExchange: z.array(z.object({ exchange: z.string(), volumeUsd: z.number() })) }).nullable(),
  latestPriceUsd: z.number().nullable(),
  /** addition: day of latestPriceUsd */
  latestPriceDate: z.string().nullable(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const postSchema = z.object({
  postId: z.number().int(), url: z.string().url(), platform: z.string(), postedAt: z.string(), views: z.number().nullable(), bookmarks: z.number().nullable(),
  author: z.object({ personId: z.number().int(), name: z.string(), handle: z.string(), kolTier: z.string().nullable(), tags: z.array(z.string()) }),
  matchType: z.string(),
});
export const postsResponseSchema = z.object({ items: z.array(postSchema), nextCursor: z.string().nullable() });
export type PostItem = z.infer<typeof postSchema>;
export type PostsResponse = z.infer<typeof postsResponseSchema>;

/** API stage names (approved contract). DB listing_events.stage 'preannounce' maps to 'teaser' in the repository. */
/** 接口里的上币阶段名（与库里 ListingStage = 'preannounce'|'spot'|'perp' 不同名，避免混淆） */
export const apiListingStageSchema = z.enum(['teaser', 'spot', 'perp']);
export type ApiListingStage = z.infer<typeof apiListingStageSchema>;
export const seriesPointSchema = z.object({
  date: z.string(), buzzScore: z.number().nullable(), buzzRankInTrack: z.number().nullable(), kolPostCount: z.number().nullable(), coreExposureCount: z.number().nullable(),
  heatScore: z.number().nullable(), spotVolumeUsd24h: z.number().nullable(), volumeRankInTrack: z.number().nullable(), priceUsd: z.number().nullable(),
});
export const listingEventSchema = z.object({ id: z.number().int(), exchange: z.string(), stage: apiListingStageSchema, date: z.string(), pair: z.string().nullable(), announcementUrl: z.string().nullable() });
export const seriesResponseSchema = z.object({ points: z.array(seriesPointSchema), listingEvents: z.array(listingEventSchema) });
export type SeriesPoint = z.infer<typeof seriesPointSchema>;
export type ApiListingEvent = z.infer<typeof listingEventSchema>;
export type SeriesResponse = z.infer<typeof seriesResponseSchema>;

// ---------- GET /projects/:id/posts 查询参数（游标分页，评审定稿）----------
/** cursor 分页：limit 默认 20，最大 50；返回 postsResponseSchema（含 nextCursor: string | null） */
export const projectPostsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ProjectPostsQuery = z.input<typeof projectPostsQuerySchema>;
