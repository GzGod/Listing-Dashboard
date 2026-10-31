// IO 层：Prisma 读核心表 → scoring.ts → Prisma 写 buzz_snapshots / project_daily → 发 daily.batch.done。不用原生 SQL。
import type { ModuleContext } from "@app/core";
import { isValidDay } from "@app/shared";
import { DEFAULTS, type ConfigKey } from "./config.js";
import { addDays, buzzRow, defaultBatchDay, dailyRow, dayIn, eachDay, pickTrack, planRecalc, rankWithinTrack, scoreDay, sumVolume, type MentionInput, type Reason } from "./scoring.js";

const cfg = <T>(ctx: ModuleContext, k: ConfigKey) => ctx.config.get<T>(k, DEFAULTS[k]);
const toDate = (d: string) => new Date(d + "T00:00:00Z");
// 切日时区只从底座配置中心读（默认值 "UTC" 在 @app/shared CONFIG_DEFAULTS 里），模块不写死
const tzOf = (ctx: ModuleContext): Promise<string> => ctx.config.get("time.dayCutTimezone");
const today = async (ctx: ModuleContext) => dayIn(new Date(), await tzOf(ctx));

/** 计算一天（可限定项目，但排名整天整赛道重算）。幂等：无数据的项目删除旧行，不写空行 */
export async function computeDay(ctx: ModuleContext, day: string, versionDay: string, projectIds?: number[]) {
  const db = ctx.db.core;
  const tz = await tzOf(ctx);
  const params = await ctx.config.scoreParams(versionDay);
  const tiers = await ctx.config.kolTiers(versionDay);
  const opt = { defaultTierWeight: await cfg<number>(ctx, "m3-engine.defaultTierWeight"), coreTags: await cfg<string[]>(ctx, "m3-engine.coreExposureTags"),
    fullScore: await cfg<boolean>(ctx, "m3-engine.multiProjectFullScore") };
  const date = toDate(day);
  // 不按项目过滤：平分模式要知道每帖提到几个项目。时间窗放宽 ±1 天，再按切日时区精确归日
  const raw = await db.postMention.findMany({
    where: { status: "confirmed", post: { postedAt: { gte: toDate(addDays(day, -1)), lt: toDate(addDays(day, 2)) } } },
    include: { post: { include: { person: { include: { tags: true } } } } },
  });
  const mentions: MentionInput[] = raw.map((m) => ({
    postId: m.postId, projectId: m.projectId, day: dayIn(m.post.postedAt, tz), views: m.post.views, bookmarks: m.post.bookmarks, status: m.status,
    inPool: !!m.post.person?.enabled, tier: m.post.person?.kolTier ?? null, tags: (m.post.person?.tags ?? []).map((t) => t.tag),
  }));
  const projects = await db.project.findMany({ select: { id: true, trackId: true } });
  const target = projectIds ? projects.filter((p) => projectIds.includes(p.id)) : projects;
  const vols = await db.volumeSnapshot.findMany({ where: { day: date }, select: { projectId: true, spotVolumeUsd24h: true } });
  const volBy = new Map<number, (number | null)[]>();
  for (const v of vols) volBy.set(v.projectId, [...(volBy.get(v.projectId) ?? []), v.spotVolumeUsd24h]);
  const prices = await db.priceSnapshot.findMany({ where: { day: date }, select: { projectId: true, priceUsd: true } });
  const priceBy = new Map(prices.map((p) => [p.projectId, p.priceUsd]));
  const exBuzz = new Map((await db.buzzSnapshot.findMany({ where: { day: date }, select: { projectId: true, trackId: true } })).map((s) => [s.projectId, s.trackId]));
  const exDaily = new Map((await db.projectDaily.findMany({ where: { day: date }, select: { projectId: true, trackId: true } })).map((s) => [s.projectId, s.trackId]));
  const adjs = await db.buzzAdjustment.findMany({ where: { day: date }, select: { projectId: true, value: true, createdAt: true, revoked: true } });

  for (const p of target) {
    const key = { projectId_day: { projectId: p.id, day: date } };
    // project_daily：无行情数据 → 无行；无赛道照写（track_id null，不参与排名）
    const d = dailyRow(volBy.has(p.id) ? sumVolume(volBy.get(p.id)!) : undefined, priceBy.get(p.id));
    if (!d) await db.projectDaily.deleteMany({ where: { projectId: p.id, day: date } });
    else {
      const data = { ...d, trackId: pickTrack(exDaily.get(p.id), p.trackId) };
      await db.projectDaily.upsert({ where: key, create: { projectId: p.id, day: date, ...data }, update: data });
    }
    // buzz_snapshots：原始分 / 仅调整的回补行 / 都没有则删除
    const s = params ? scoreDay(p.id, day, mentions, params, tiers, opt) : null;
    const mine = adjs.filter((x) => x.projectId === p.id).map((x) => ({ value: x.value, createdAt: x.createdAt.toISOString(), revoked: x.revoked }));
    const row = buzzRow(s, mine, exBuzz.get(p.id), p.trackId);
    if (!row) { await db.buzzSnapshot.deleteMany({ where: { projectId: p.id, day: date } }); continue; }
    await db.buzzSnapshot.upsert({ where: key, create: { projectId: p.id, day: date, ...row }, update: row });
  }
  // 当天全部赛道排名重算（插入/删除后整赛道重排，删除行的旧赛道也在其中；track_id null 不排名）
  const dailies = await db.projectDaily.findMany({ where: { day: date }, select: { id: true, projectId: true, trackId: true, totalSpotVolumeUsd: true } });
  const vr = rankWithinTrack(dailies.map((r) => ({ projectId: r.projectId, trackId: r.trackId, value: r.totalSpotVolumeUsd })));
  for (const r of dailies) await db.projectDaily.update({ where: { id: r.id }, data: { volumeTrackRank: vr.get(r.projectId) ?? null } });
  const snaps = await db.buzzSnapshot.findMany({ where: { day: date }, select: { id: true, projectId: true, trackId: true, adjustedTotal: true } });
  const br = rankWithinTrack(snaps.map((r) => ({ projectId: r.projectId, trackId: r.trackId, value: r.adjustedTotal })));
  for (const r of snaps) await db.buzzSnapshot.update({ where: { id: r.id }, data: { trackRank: br.get(r.projectId) ?? null } });
}

/** 日批：算 今天-lag 那天以及回抓窗口内的前几天（帖子数据还在更新），每天用当日版本 */
export async function runDaily(ctx: ModuleContext, endDay?: string) {
  if (endDay !== undefined && !isValidDay(endDay)) throw new Error(`非法日期 ${endDay}`);
  // market.snapshot.ingested 的 date / 手动 date 已是切日时区下的日历日；不传则按切日时区的今天 - lag
  const end = endDay ?? defaultBatchDay(new Date(), await tzOf(ctx), await cfg<number>(ctx, "m3-engine.batchLagDays"));
  const from = addDays(end, -((await ctx.config.get("posts.refetchDays")) - 1));
  for (const d of eachDay(from, end)) await computeDay(ctx, d, d);
  await ctx.events.emit("daily.batch.done", { dateFrom: from, dateTo: end });
}

export async function runRecalc(ctx: ModuleContext, p: { reason: Reason; projectIds?: number[]; dateFrom: string; dateTo: string }) {
  if (!isValidDay(p.dateFrom) || !isValidDay(p.dateTo) || p.dateFrom > p.dateTo) throw new Error(`非法日期范围 ${p.dateFrom}~${p.dateTo}`);
  const max = await cfg<number>(ctx, "m3-engine.recalcMaxDays");
  if (eachDay(p.dateFrom, p.dateTo).length > max) throw new Error(`重算范围超过 ${max} 天`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const eff = [...(await ctx.db.core.scoreParams.findMany({ select: { effectiveFrom: true } })), ...(await ctx.db.core.kolTier.findMany({ select: { effectiveFrom: true } }))].map((r) => iso(r.effectiveFrom));
  const plan = planRecalc(p.reason, p.dateFrom, p.dateTo, eff, await today(ctx));
  if (!plan.length) return;
  for (const x of plan) await computeDay(ctx, x.day, x.versionDay, p.projectIds);
  await ctx.events.emit("daily.batch.done", { dateFrom: plan[0].day, dateTo: plan[plan.length - 1].day });
}
