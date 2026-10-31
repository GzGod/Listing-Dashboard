import type { Fundamentals, Team } from "./project-schemas.js";
import type { Role, Project, ProjectDaily, BuzzSnapshot, ListingStage } from "./tables.js";
// 统一错误格式：所有接口出错都返回这个结构
export interface ApiError { error: { code: string; message: string; module?: string; requestId?: string } }
export interface LoginRequest { email: string; password: string }
export interface LoginResponse { token: string; user: { id: number; email: string; name: string; role: Role; permissions: string[] } }
export interface MenuItem { module: string; area: "front" | "admin"; path: string; title: string; permission?: string; kind: "internal" | "external"; available: boolean; hidden: boolean /* 可访问但不进菜单 */ }
export interface ModuleInfo { id: string; name: string; version: string; apiVersion: number; kind: "internal" | "external"; status: string; error?: string }

// ---------------- 前台只读接口契约（预留，仅类型 + 假数据；实现归 M5/M6，底座不实现） ----------------
export type Window = 1 | 7 | 30;
/** GET /calendar */
export interface CalendarQuery { from: string; to: string; exchangeId?: number; trackId?: number }
export interface CalendarItem { listingId: number; day: string; stage: ListingStage; pair: string | null; announcementUrl: string | null;
  exchange: { id: number; name: string }; project: { id: number; name: string; symbol: string; trackId: number | null } }
export interface CalendarResponse { from: string; to: string; items: CalendarItem[] }
/** GET /projects/:id  含 PD-01 基本面/团队、PD-02 龙哥评级 */
export interface ProjectResponse {
  project: Pick<Project, "id" | "name" | "symbol" | "trackId"> & {
    fundamentals: Fundamentals | null; team: Team | null;        // PD-01（后台手动录入，结构见 project-schemas.ts）
    logoUrl: string | null; websiteUrl: string | null; xHandle: string | null; docsUrl: string | null;
    usersCount: number | null; usersAsOf: string | null; usersSource: string | null;
    revenueUsd: string | null; revenuePeriod: string | null; revenueAsOf: string | null; revenueSource: string | null;
    longgeRating: string | null; longgeRatedAt: string | null;   // PD-02（MVP 手动录入，V2 对接龙哥系统）
  };
  track: { id: number; name: string; parentId: number | null } | null;
  contracts: { chain: string; address: string }[];
  listings: CalendarItem[];
}
/** ===== /rankings、/projects/:id/series、/projects/:id/posts（以及 /projects/:id 详情）的契约归 M5M6 模块所有 =====
 * 占位 zod 契约见 ./contracts/m5m6.ts（按 M5M6 现有草稿改写），通过 `m5m6` 命名空间导出；M5M6 定稿后由他们替换。 */
/** 游标分页（帖子列表等）：nextCursor 为 null 表示没有下一页 */
export interface CursorPage<T> { items: T[]; nextCursor: string | null }
// 兼容旧名
export type { ProjectDaily, BuzzSnapshot };
