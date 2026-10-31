// 纯计算逻辑（无 IO）。S(p,T) = Σ w(tier) × (a×views + b×bookmarks)
import { competitionRank } from "@app/shared";

export interface ParamsRow { version: string; a: number; b: number }
export interface TierSet { version: string; weights: Record<string, number> }
export interface MentionInput { postId: number; projectId: number; day: string; views: number; bookmarks: number; status: string; inPool: boolean; tier: string | null; tags: string[] }
export interface DayScore { projectId: number; day: string; kolPostCount: number; coreExposureCount: number; heatScore: number; rawTotal: number; paramsVersion: string; tiersVersion: string | null }
export interface ScoreOpt { defaultTierWeight: number; coreTags: string[]; fullScore: boolean }

/** 只算 status=confirmed 且人物池内（people.enabled）的帖子 */
export const countable = (m: MentionInput) => m.status === "confirmed" && m.inPool;

/** 某项目某天的分数；当天没有可计分帖子 → null（不写行） */
export function scoreDay(projectId: number, day: string, mentions: MentionInput[], params: ParamsRow, tiers: TierSet | null, opt: ScoreOpt): DayScore | null {
  const ok = mentions.filter(countable);
  const mine = new Map(ok.filter((m) => m.projectId === projectId && m.day === day).map((m) => [m.postId, m]));
  if (!mine.size) return null;
  const nProj = new Map<number, Set<number>>();
  for (const m of ok) nProj.set(m.postId, (nProj.get(m.postId) ?? new Set()).add(m.projectId));
  const core = new Set(opt.coreTags);
  let heat = 0, coreN = 0;
  for (const m of mine.values()) {
    const w = (m.tier != null ? tiers?.weights[m.tier] : undefined) ?? opt.defaultTierWeight;
    const share = opt.fullScore ? 1 : 1 / (nProj.get(m.postId)?.size ?? 1);
    heat += share * w * (params.a * m.views + params.b * m.bookmarks);
    if (m.tags.some((t) => core.has(t))) coreN++;
  }
  return { projectId, day, kolPostCount: mine.size, coreExposureCount: coreN, heatScore: heat, rawTotal: heat, paramsVersion: params.version, tiersVersion: tiers?.version ?? null };
}
export interface AdjustmentRow { value: number; createdAt: string; revoked: boolean }
/** 只调总分：adjusted = 未撤销调整里最新一条 ?? raw；子项永远是原始值 */
export function applyOverride(raw: number, adj: AdjustmentRow[]): number {
  const live = adj.filter((a) => !a.revoked).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  return live.length ? live[0].value : raw;
}
/** 同日同赛道竞争排名（1,1,3；同分按 projectId 升序；null 不参与）——薄封装 @app/shared competitionRank */
export function rankWithinTrack(rows: { projectId: number; trackId: number | null; value: number | null }[]): Map<number, number> {
  const out = new Map<number, number>();
  const groups = new Map<number, typeof rows>();
  for (const r of rows) if (r.trackId != null) groups.set(r.trackId, [...(groups.get(r.trackId) ?? []), r]);
  for (const g of groups.values()) for (const { item, rank } of competitionRank(g, (r) => r.value, (r) => r.projectId)) out.set(item.projectId, rank);
  return out;
}
/** 快照赛道：已有行就沿用它的 track_id（含 null）；没有行（undefined）才用 projects.track_id */
export const pickTrack = (existing: number | null | undefined, current: number | null) => (existing === undefined ? current : existing);

export interface BuzzRowOut { trackId: number | null; kolPostCount: number | null; coreExposureCount: number | null; heatScore: number | null; rawTotal: number | null;
  adjustedTotal: number; paramsVersion: string | null; tiersVersion: string | null }
/**
 * 一个项目一天的 buzz_snapshots 行：
 * - 有原始分：正常写，adjusted = 调整 ?? raw
 * - 无原始分但有未撤销调整：回补调整行，raw 和子项为 null，adjusted = 调整值
 * - 都没有：null（不写行 / 删除旧行）
 * existingTrack：该日已有行的 track_id（undefined = 没有行）
 */
export function buzzRow(score: DayScore | null, adj: AdjustmentRow[], existingTrack: number | null | undefined, currentTrack: number | null): BuzzRowOut | null {
  const live = adj.filter((a) => !a.revoked);
  const trackId = pickTrack(existingTrack, currentTrack);
  if (score) return { trackId, kolPostCount: score.kolPostCount, coreExposureCount: score.coreExposureCount, heatScore: score.heatScore, rawTotal: score.rawTotal,
    adjustedTotal: applyOverride(score.rawTotal, adj), paramsVersion: score.paramsVersion, tiersVersion: score.tiersVersion };
  if (!live.length) return null;
  return { trackId, kolPostCount: null, coreExposureCount: null, heatScore: null, rawTotal: null, adjustedTotal: applyOverride(0, live), paramsVersion: null, tiersVersion: null };
}
/** project_daily 行：成交额、币价都没有 → null（不写行）；缺一项该列 null */
export function dailyRow(vol: number | null | undefined, price: number | null | undefined) {
  if (vol == null && price == null) return null;
  return { totalSpotVolumeUsd: vol ?? null, priceUsd: price ?? null };
}
/** 当天各交易所成交额求和；全为 null → null */
export function sumVolume(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) : null;
}
export type Reason = "weights_changed" | "manual_adjust" | "mention_changed" | "manual_backfill";
/**
 * 重算计划：weights_changed 从最新生效版本（score_params 或 kol_tiers）的生效日往后算，每天用当日版本；
 * manual_backfill 用当前版本（versionDay = today）；其他按当日版本。
 */
export function planRecalc(reason: Reason, dateFrom: string, dateTo: string, effectiveDates: string[], today: string) {
  let from = dateFrom;
  const to = capToToday(dateTo, today);
  if (reason === "weights_changed") {
    const eff = effectiveDates.filter((d) => d <= today).sort().pop();
    if (eff && eff > from) from = eff;
  }
  return eachDay(from, to).map((day) => ({ day, versionDay: reason === "manual_backfill" ? today : day }));
}
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
export function addDays(day: string, n: number): string { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** 时间点在切日时区（time.dayCutTimezone）下的日历日 YYYY-MM-DD。"UTC" 时等同 toISOString().slice(0,10) */
export function dayIn(ts: Date, tz: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts); }
/** 重算范围上限：不算切日时区下"今天"之后的日子 */
export const capToToday = (dateTo: string, today: string) => (dateTo > today ? today : dateTo);
/** 日批默认日期：切日时区下的今天 - lagDays */
export const defaultBatchDay = (now: Date, tz: string, lagDays: number) => addDays(dayIn(now, tz), -lagDays);
