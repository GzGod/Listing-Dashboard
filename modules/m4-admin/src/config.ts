// M4 所有"可能会变"的东西集中在这里。系统级配置可用底座配置中心覆盖：环境变量 MOD_M4_ADMIN_<KEY>（ctx.config.get）。
// score_params 只放打分系数 a/b（带版本、生效日）；KOL 权重在 kol_tiers；回看天数、窗口是系统配置（底座配置中心）。
import type { ModuleContext } from "@app/core";

export const MODULE_NAME = "m4-admin";

/** 事件名 */
export const EVENTS = { recalc: "recalc.requested" } as const;

/** recalc.requested 的 reason 枚举（评审定稿：只有这 4 个） */
export const RECALC_REASONS = {
  weightsChanged: "weights_changed",
  manualAdjust: "manual_adjust",
  mentionChanged: "mention_changed", // M2 发，M4 不用
  manualBackfill: "manual_backfill",
} as const;
export type RecalcReason = (typeof RECALC_REASONS)[keyof typeof RECALC_REASONS];

/** 权限 */
export const PERMS = { write: "m4-admin:write", view: "admin:access" } as const;
export const WRITE_ROLES = ["admin", "editor"] as const;

/** 核心表名（写入声明 + 审计用） */
export const TABLES = {
  projects: "projects", contracts: "project_contracts", aliases: "project_aliases", listings: "listing_events",
  tracks: "tracks", people: "people", personTags: "person_tags", scoreParams: "score_params",
  buzzSnapshots: "buzz_snapshots", buzzAdjustments: "buzz_adjustments", kolTiers: "kol_tiers",
} as const;
/** 私有表短名（实际表名 = m_m4_admin_<短名>） */
export const OWN = { mockReview: "mock_review" } as const;


/** 外部接口路径（M2 走底座代理 /api/m2-matcher/*；底座账号接口见 MODULE_GUIDE §11） */
export const ENDPOINTS = {
  m2ReviewQueue: "/review-queue",
  m2ReviewPost: (postId: number) => `/review/posts/${postId}`, // 按帖子提交（旧的 /review/:mentionId 已废弃）
  coreUsers: "/api/_core/users",
} as const;

export const NO_SNAPSHOT_REASON_MSG = "当天无快照，补分须填写理由";

/** M2 按帖子确认接口 POST /review/posts/:postId 的请求体：勾选的候选 = confirmed，未勾选 = rejected；空数组 = 该帖所有 pending 候选驳回 */
export const buildM2ReviewBody = (projectIds: number[]) => ({ projectIds });
/** 前端 → M4 的请求体同样只认 projectIds */
export const parseReviewInput = (b: any): number[] | null => (Array.isArray(b?.projectIds) ? b.projectIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null);

/** 本模块配置键（manifest config 声明，前缀 m4-admin.；可被 system_config / CONFIG_M4_ADMIN_* 覆盖） */
export const CONFIG = [
  { key: "m4-admin.m2BasePath", default: "/api/m2-matcher", description: "M2 在底座下的路径前缀（进程内经底座路由调用，不需要底座地址/端口）" },
  { key: "m4-admin.m2Mock", default: "off", description: "枚举 auto|on|off：默认 off；on 为显式演示模式；auto 为演示兼容模式" },
  { key: "m4-admin.m2TimeoutMs", default: 5000, description: "调 M2 超时" },
  { key: "m4-admin.backfillFrom", default: "2025-01-01", description: "手动回算默认起点（按 time.dayCutTimezone 切日的日期）", public: true },
] as const;
type CfgKey = (typeof CONFIG)[number]["key"];
const def = (k: CfgKey) => CONFIG.find((c) => c.key === k)!.default;

export const M2_MOCK_MODES = ["auto", "on", "off"] as const;
export type M2MockMode = (typeof M2_MOCK_MODES)[number];
/** 非法值（含布尔）关闭假数据回退 */
export const toM2Mock = (v: unknown): M2MockMode => ((M2_MOCK_MODES as readonly unknown[]).includes(v) ? (v as M2MockMode) : "off");

/** 赛道停用开关：底座 tracks.disabled_at 列上线后自动启用（检测 information_schema，结果缓存） */
let tracksDisableCache: boolean | null = null;
export async function tracksDisableSupported(ctx: ModuleContext): Promise<boolean> {
  if (tracksDisableCache !== null) return tracksDisableCache;
  const rows = await ctx.db.core.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tracks' AND column_name = 'disabled_at'`;
  tracksDisableCache = (rows[0]?.n ?? 0) > 0;
  return tracksDisableCache;
}
export const TRACK_IN_USE_MSG = "该赛道已被使用，不能删除，请改用停用";

/** 运行时取值：本模块键 + 底座共享键（pagination.*） */
export async function runtime(ctx: ModuleContext) {
  const g = async <T>(k: string, d: T): Promise<T> => (await ctx.config.get<T>(k, d)) ?? d;
  return {
    m2BasePath: String(await g("m4-admin.m2BasePath", def("m4-admin.m2BasePath"))),
    m2Mock: toM2Mock(await g("m4-admin.m2Mock", def("m4-admin.m2Mock"))),
    m2TimeoutMs: Number(await g("m4-admin.m2TimeoutMs", def("m4-admin.m2TimeoutMs"))),
    backfillFrom: String(await g("m4-admin.backfillFrom", def("m4-admin.backfillFrom"))),
    pageSize: Number(await ctx.config.get("pagination.defaultPageSize")),
    maxPageSize: Number(await ctx.config.get("pagination.maxPageSize")),
  };
}

/** 底座共享配置键（只读展示） */
export const SYSTEM_CONFIG_KEYS = { refetchDays: "posts.refetchDays", windows: "ranking.windows", defaultWindow: "ranking.defaultWindow" } as const;
/** 底座 projects 的 PD-01/02 字段（与 schema 对齐；新增列在这里加一行） */
export const PROJECT_FIELDS = ["name", "symbol", "coingeckoId", "trackId", "fundamentals", "team", "logoUrl", "websiteUrl", "xHandle", "docsUrl", "usersCount", "usersAsOf", "usersSource", "revenueUsd", "revenuePeriod", "revenueAsOf", "revenueSource", "longgeRating", "longgeRatedAt"] as const;
export const PROJECT_DATE_FIELDS = ["usersAsOf", "revenueAsOf", "longgeRatedAt"] as const;
/** 上币阶段（库里 ListingStage） */
export const LISTING_STAGES = ["preannounce", "spot", "perp"] as const;
/** 别名类型 */
export const ALIAS_KINDS = ["ticker", "name", "contract"] as const;
export const REVIEW_404_MSG = "该帖子已审核或不存在";
/** M2 模块名（判断 404 是不是 M2 自己返回的） */
export const M2_MODULE = "m2-matcher";
