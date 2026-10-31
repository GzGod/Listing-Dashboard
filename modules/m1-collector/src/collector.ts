import type { ModuleContext } from "@app/core";
import { AppError } from "@app/core";
import { isValidDay } from "@app/shared";
import { loadConfig, OWN, PLATFORM_X, type M1Config } from "./config.js";
import { dayIn, dbDate, inRefetchWindow } from "./day.js";
import { MockXSource, XApiSource, type XSource } from "./adapters/x.js";
import { liveVolumeSources, livePriceSource, mockVolumeSources, mockPriceSource } from "./adapters/market.js";

const http = (c: M1Config) => ({ timeoutMs: c.httpTimeoutMs, retries: c.httpRetries, retryDelayMs: c.httpRetryDelayMs });

async function xBudget(ctx: ModuleContext, c: M1Config) {
  const [r] = await ctx.db.query<{ count: number }>(`SELECT count FROM ${ctx.db.t(OWN.runs)} WHERE kind='x_calls' AND day=$1::date`, dayIn(c.tz));
  return { left: c.xDailyCap - (r?.count ?? 0) };
}
async function saveBudget(ctx: ModuleContext, c: M1Config, b: { left: number }) {
  await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.runs)} (kind, day, count) VALUES ('x_calls', $1::date, $2) ON CONFLICT (kind, day) DO UPDATE SET count=$2, updated_at=now()`, dayIn(c.tz), c.xDailyCap - Math.max(0, b.left));
}
export function makeXSource(ctx: ModuleContext, c: M1Config, budget: { left: number }): XSource {
  if (c.xSource === "xapi") return new XApiSource(c.xApiBaseUrl, ctx.config.env("X_BEARER_TOKEN") ?? process.env.X_BEARER_TOKEN ?? "", http(c), c.xRateLimitPerMin, budget);
  return new MockXSource();
}

/** 抓人物池新帖 → upsert posts → 发 post.ingested */
export async function collectPosts(ctx: ModuleContext) {
  const c = await loadConfig(ctx); const budget = await xBudget(ctx, c); const x = makeXSource(ctx, c, budget);
  const platform = await ctx.db.core.platform.findUnique({ where: { name: PLATFORM_X } });
  if (!platform) throw new Error(`platforms 表里没有 ${PLATFORM_X}`);
  const people = await ctx.db.core.person.findMany({ where: { platformId: platform.id, enabled: true } });
  const ids: number[] = [];
  try {
    for (const p of people) {
      const [cur] = await ctx.db.query<{ since_id: string | null }>(`SELECT since_id FROM ${ctx.db.t(OWN.cursors)} WHERE person_id=$1`, p.id);
      const posts = await x.userTimeline(p.handle, { sinceId: cur?.since_id ?? undefined, max: c.xMaxPostsPerPerson });
      for (const t of posts) {
        const row = await ctx.db.core.post.upsert({
          where: { platformId_platformPostId: { platformId: platform.id, platformPostId: t.id } },
          create: { personId: p.id, platformId: platform.id, platformPostId: t.id, postedAt: new Date(t.postedAt), views: t.views, bookmarks: t.bookmarks, url: t.url, text: t.text, lastFetchedAt: new Date() },
          update: { views: t.views, bookmarks: t.bookmarks, lastFetchedAt: new Date() },
        });
        ids.push(row.id);
      }
      const maxId = posts.map((t) => BigInt(t.id)).reduce((a, b) => (b > a ? b : a), cur?.since_id ? BigInt(cur.since_id) : 0n);
      await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.cursors)} (person_id, since_id, last_run_at) VALUES ($1,$2,now()) ON CONFLICT (person_id) DO UPDATE SET since_id=$2, last_run_at=now()`, p.id, maxId ? maxId.toString() : null);
    }
  } finally { await saveBudget(ctx, c, budget); }
  for (let i = 0; i < ids.length; i += c.ingestBatchSize)
    await ctx.events.emit("post.ingested", { postIds: ids.slice(i, i + c.ingestBatchSize), platform: PLATFORM_X, ingestedAt: new Date().toISOString() });
  ctx.log.info(`collectPosts 完成`, { people: people.length, posts: ids.length });
  return { posts: ids.length };
}

/** 回抓发帖 refetchDays 天内的帖子指标；超过的标 frozen */
export async function refetchMetrics(ctx: ModuleContext) {
  const c = await loadConfig(ctx); const budget = await xBudget(ctx, c); const x = makeXSource(ctx, c, budget);
  // 回抓窗口按发帖日（切日时区）：发帖日 >= 今天 - refetchDays 继续回抓，否则冻结
  const open = await ctx.db.core.post.findMany({ where: { frozen: false }, select: { id: true, platformPostId: true, postedAt: true } });
  const now = new Date();
  const expired = open.filter((p) => !inRefetchWindow(p.postedAt, c.refetchDays, c.tz, now)).map((p) => p.id);
  if (expired.length) await ctx.db.core.post.updateMany({ where: { id: { in: expired } }, data: { frozen: true } });
  const live = open.filter((p) => inRefetchWindow(p.postedAt, c.refetchDays, c.tz, now));
  let n = 0;
  try {
    for (let i = 0; i < live.length; i += c.xLookupBatch) {
      const chunk = live.slice(i, i + c.xLookupBatch);
      for (const m of await x.lookup(chunk.map((p) => p.platformPostId))) {
        const p = chunk.find((q) => q.platformPostId === m.id)!;
        await ctx.db.core.post.update({ where: { id: p.id }, data: { views: m.views, bookmarks: m.bookmarks, lastFetchedAt: new Date() } }); n++;
      }
    }
  } finally { await saveBudget(ctx, c, budget); }
  return { refetched: n };
}

/** 拉某一天（切日时区 time.dayCutTimezone，默认今天）的成交额 + 币价；全部项目齐了才发一次 market.snapshot.ingested */
export async function collectMarket(ctx: ModuleContext, dateArg?: unknown) {
  const c = await loadConfig(ctx);
  if (dateArg != null && (typeof dateArg !== "string" || !isValidDay(dateArg))) throw new AppError(400, "BAD_INPUT", "date 需为 YYYY-MM-DD");
  const date = (dateArg as string | undefined) ?? dayIn(c.tz);
  const [run] = await ctx.db.query<{ done: boolean }>(`SELECT done FROM ${ctx.db.t(OWN.runs)} WHERE kind='market' AND day=$1::date`, date);
  const projects = await ctx.db.core.project.findMany({ select: { id: true, symbol: true } });
  const exchanges = await ctx.db.core.exchange.findMany({ where: { enabled: true, name: { in: c.exchanges } } });
  const vs = c.marketSource === "mock" ? mockVolumeSources(c.exchanges)
    : liveVolumeSources({ binance: c.binanceBaseUrl, okx: c.okxBaseUrl, bybit: c.bybitBaseUrl }, http(c));
  const day = dbDate(date); const failed: string[] = [];
  for (const ex of exchanges) {
    const src = vs[ex.name]; if (!src) { failed.push(`${ex.name}: 没有适配器`); continue; }
    try {
      const vols = await src.spotVolumesUsd(projects.map((p) => p.symbol), c.usdQuotes);
      for (const p of projects) {
        const v = vols.get(p.symbol.toUpperCase()); if (v == null) continue; // 该所没上这个币
        await ctx.db.core.volumeSnapshot.upsert({ where: { projectId_exchangeId_day: { projectId: p.id, exchangeId: ex.id, day } },
          create: { projectId: p.id, exchangeId: ex.id, day, spotVolumeUsd24h: v }, update: { spotVolumeUsd24h: v } });
      }
    } catch (e: any) { failed.push(`${ex.name}: ${e?.message ?? e}`); }
  }
  // 币价：只拉 projects.coingecko_id 有值的项目（M4 维护）；没填的跳过并记日志，不阻塞当天事件
  const withId = await ctx.db.core.project.findMany({ where: { coingeckoId: { not: null } }, select: { id: true, coingeckoId: true } });
  const skipped = projects.length - withId.length;
  if (skipped) ctx.log.warn(`${skipped} 个项目没有 coingecko_id，跳过币价`, { date });
  try {
    const ps = c.marketSource === "mock" ? mockPriceSource : livePriceSource(c.coingeckoBaseUrl, http(c), ctx.config.env("COINGECKO_API_KEY"));
    const prices = await ps.pricesUsd(withId.map((m) => m.coingeckoId!));
    for (const m of withId) {
      const px = prices.get(m.coingeckoId!) ?? null; // 请求成功但该币没价格 → 写 null（null ≠ 0）
      await ctx.db.core.priceSnapshot.upsert({ where: { projectId_day: { projectId: m.id, day } },
        create: { projectId: m.id, day, priceUsd: px, source: "coingecko" }, update: { priceUsd: px, fetchedAt: new Date() } });
    }
  } catch (e: any) { failed.push(`coingecko: ${e?.message ?? e}`); }
  // 失败抛错 → 底座队列按 queue.attempts 重试，用尽进死信；全部成功才发事件
  if (failed.length) throw new Error(`行情未拉齐 ${date}: ${failed.join("; ")}`);
  await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.runs)} (kind, day, done) VALUES ('market', $1::date, true) ON CONFLICT (kind, day) DO UPDATE SET done=true, updated_at=now()`, date);
  if (!run?.done) await ctx.events.emit("market.snapshot.ingested", { date });
  return { date, exchanges: exchanges.length, projects: projects.length, priceSkipped: skipped, emitted: !run?.done };
}
