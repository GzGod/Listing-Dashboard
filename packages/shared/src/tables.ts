import type { Fundamentals, Team, RevenuePeriod } from "./project-schemas.js";
// PRD v0.3 第 10 节核心表的共享类型（前后端共用）。字段与 packages/db/prisma/schema.prisma 一一对应。
// 日期字段统一为 ISO 字符串；"day" 是 UTC 0 点切日的 YYYY-MM-DD。
export type ID = number;
export interface Exchange { id: ID; name: string; type: "CEX" | "DEX"; enabled: boolean }
export interface Platform { id: ID; name: string; enabled: boolean }
export interface KolTier { id: ID; version: string; effectiveFrom: string; name: string; weight: number; createdBy: ID | null; createdAt: string }
/** 某天生效的一整套 KOL 等级权重 */
export interface KolTierSet { version: string; effectiveFrom: string; weights: Record<string, number> }
export interface ScoreParams { id: ID; version: string; effectiveFrom: string /* UTC YYYY-MM-DD */; a: number; b: number; updateFrequency: string; createdBy: ID | null; updatedAt: string }
export interface BuzzAdjustment { id: ID; projectId: ID; day: string; buzzSnapshotId: ID | null; value: number; reason: string | null; createdBy: ID | null; createdAt: string; revoked: boolean }
export interface SystemConfigRow { key: string; value: unknown; updatedBy: ID | null; updatedAt: string }
export interface Track { id: ID; name: string; parentId: ID | null }
export interface Project {
  id: ID; name: string; symbol: string; trackId: ID | null; coingeckoId: string | null;
  fundamentals: Fundamentals | null; team: Team | null;
  logoUrl: string | null; websiteUrl: string | null; xHandle: string | null; docsUrl: string | null;
  usersCount: number | null; usersAsOf: string | null; usersSource: string | null;
  revenueUsd: string | null /* Decimal 以字符串传输 */; revenuePeriod: RevenuePeriod | string | null; revenueAsOf: string | null; revenueSource: string | null;
  longgeRating: string | null; longgeRatedAt: string | null; createdAt: string;
}
export interface ProjectContract { id: ID; projectId: ID; chain: string; address: string }
export interface ProjectAlias { id: ID; projectId: ID; alias: string; kind: "ticker" | "name" | "contract" }
export type ListingStage = "preannounce" | "spot" | "perp";
export interface ListingEvent {
  id: ID; projectId: ID; exchangeId: ID; day: string; stage: ListingStage; pair: string | null; announcementUrl: string | null;
}
export type PersonTagKind = "exchange_core" | "top_vc" | "whale" | "top_kol";
export interface Person {
  id: ID; displayName: string; handle: string; platformId: ID; kolTier: string | null /* 等级名 */; enabled: boolean; joinedPoolAt: string;
}
export interface PersonTag { id: ID; personId: ID; tag: PersonTagKind }
export interface Post {
  id: ID; personId: ID; platformId: ID; platformPostId: string; postedAt: string; views: number | null; bookmarks: number | null;
  url: string; text: string | null; lastFetchedAt: string | null; frozen: boolean;
}
export type MatchMethod = "ticker" | "name" | "contract";
export type MentionStatus = "pending" | "confirmed" | "rejected";
export interface PostMention { id: ID; postId: ID; projectId: ID; matchMethod: MatchMethod; status: MentionStatus; reviewedBy: ID | null; reviewedAt: string | null }
export interface BuzzSnapshot {
  id: ID; projectId: ID; day: string; trackId: ID | null;
  kolPostCount: number | null; coreExposureCount: number | null; heatScore: number | null; // 三子项，只存原始值；当天无原始数据（只有人工调整）时为 null
  paramsVersion: string | null;           // 计算时用的 score_params.version
  tiersVersion: string | null;            // 计算时用的 kol_tiers.version
  rawTotal: number | null;                // 原始总分（m3-engine）；无原始数据时 null
  trackRank: number | null;               // 同赛道按 adjustedTotal 的排名（并列同名次，下一名跳号 1,1,3）
  adjustedTotal: number;                  // = 最新未撤销 buzz_adjustments.value ?? rawTotal（m3-engine 写），前台展示/排名用
}
export interface VolumeSnapshot { id: ID; projectId: ID; exchangeId: ID; day: string; spotVolumeUsd24h: number | null; source: string; fetchedAt: string }
export interface PriceSnapshot { id: ID; projectId: ID; day: string; priceUsd: number | null; source: string; fetchedAt: string }
export interface ProjectDaily {
  id: ID; projectId: ID; day: string; trackId: ID | null /* 当日所属赛道；项目还没赛道时 null，此时 volumeTrackRank 也是 null */; totalSpotVolumeUsd: number | null; volumeTrackRank: number | null /* 同赛道成交额排名，1,1,3 */; priceUsd: number | null;
}
export interface AuditLog {
  id: ID; actorId: ID | null; module: string; action: string; table: string | null; recordId: string | null;
  before: unknown; after: unknown; createdAt: string;
}
export type Role = "admin" | "editor" | "viewer";
export interface User { id: ID; email: string; name: string; role: Role; enabled: boolean }
