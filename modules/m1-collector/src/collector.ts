import type { ModuleContext } from "@app/core";
import { AppError } from "@app/core";
import { isValidDay } from "@app/shared";
import { loadConfig, OWN, PLATFORM_X, type M1Config } from "./config.js";
import { addDays, dayIn, dayStartMs, dbDate, inRefetchWindow } from "./day.js";
import { MockXSource, XApiSource, type XSource } from "./adapters/x.js";
import { liveVolumeSources, livePriceSource, mockVolumeSources, mockPriceSource, bounds } from "./adapters/market.js";
import { resolveAssets, type AssetMapping } from "./assets.js";
import { claimRateSlot, claimXCall, flushOutbox, queueEvent, recordRun, withRunLock } from "./state.js";
import { HttpError } from "./http.js";

const http = (c: M1Config) => ({ timeoutMs: c.httpTimeoutMs, retries: c.httpRetries, retryDelayMs: c.httpRetryDelayMs, maxRetryDelayMs: c.httpMaxRetryDelayMs });
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
interface Cursor { person_id: number; since_id: string | null; source: string | null; page_token: string | null; newest_id: string | null; last_run_at: Date | null }
export function makeXSource(ctx: ModuleContext, c: M1Config, budget = { left: c.xDailyCap }): XSource {
  if (c.xSource === "disabled") throw new AppError(503, "SOURCE_DISABLED", "X 数据源尚未配置");
  if (c.xSource === "mock") return new MockXSource();
  return new XApiSource(c.xApiBaseUrl, ctx.config.env("X_BEARER_TOKEN") ?? process.env.X_BEARER_TOKEN ?? "", http(c), c.xRateLimitPerMin,
    { ...budget, consume: () => claimXCall(ctx, c) }, {
      get: async (handle) => { const [r] = await ctx.db.query<{ platform_user_id: string | null }>(`SELECT c.platform_user_id FROM ${ctx.db.t(OWN.cursors)} c JOIN people p ON p.id=c.person_id WHERE lower(ltrim(p.handle,'@'))=$1 AND c.source='xapi'`, handle); return r?.platform_user_id ?? undefined; },
      set: async (handle, id) => { await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.cursors)} (person_id,source,platform_user_id)
        SELECT id,'xapi',$2 FROM people WHERE lower(ltrim(handle,'@'))=$1 AND platform_id=(SELECT id FROM platforms WHERE name=$3)
        ON CONFLICT (person_id) DO UPDATE SET platform_user_id=$2`, handle, id, PLATFORM_X); },
    });
}

/** 每页持久化后再推进分页断点；全部分页完成才推进 since_id。 */
export async function collectPosts(ctx: ModuleContext) {
  const c = await loadConfig(ctx);
  if (c.xSource === "disabled") { await recordRun(ctx, "posts", dayIn(c.tz), { source: "disabled", status: "not_configured" }, false); return { posts: 0, skipped: "not_configured" }; }
  return withRunLock(ctx, "social", c.runLockTtlMs, async (check) => {
    await flushOutbox(ctx); const x = makeXSource(ctx, c);
    const platform = await ctx.db.core.platform.findUnique({ where: { name: PLATFORM_X } });
    if (!platform?.enabled) return { posts: 0, skipped: "platform_disabled" };
    const cursors = new Map((await ctx.db.query<Cursor>(`SELECT * FROM ${ctx.db.t(OWN.cursors)}`)).map((r) => [r.person_id, r]));
    const people = (await ctx.db.core.person.findMany({ where: { platformId: platform.id, enabled: true } }))
      .sort((a, b) => (cursors.get(a.id)?.last_run_at?.getTime() ?? 0) - (cursors.get(b.id)?.last_run_at?.getTime() ?? 0) || a.id - b.id);
    let n = 0; const failed: { personId: number; error: string }[] = []; const pending: number[] = [];
    for (const p of people) {
      const prior = cursors.get(p.id); let cur = prior?.source === c.xSource ? prior : undefined;
      try {
        for (let i = 0; i < c.xMaxPagesPerPerson; i++) {
          check();
          const page = await x.userTimelinePage(p.handle, { sinceId: cur?.since_id ?? undefined, nextToken: cur?.page_token ?? undefined, max: c.xMaxPostsPerPerson });
          if (page.nextToken && page.nextToken === cur?.page_token) throw new Error("X 分页 token 未推进");
          const ids: number[] = [];
          for (const t of page.posts) {
            if (new Date(t.postedAt) > new Date()) throw new Error("数据源返回未来发帖时间");
            check();
            const where = { platformId_platformPostId: { platformId: platform.id, platformPostId: t.id } };
            const existing = await ctx.db.core.post.findUnique({ where, select: { frozen: true } });
            const row = await ctx.db.core.post.upsert({ where,
              create: { personId: p.id, platformId: platform.id, platformPostId: t.id, postedAt: new Date(t.postedAt), views: t.views, bookmarks: t.bookmarks, url: t.url, text: t.text, lastFetchedAt: new Date(), frozen: !inRefetchWindow(new Date(t.postedAt), c.refetchDays, c.tz) },
              update: { url: t.url, text: t.text, ...(!existing?.frozen ? { views: t.views ?? undefined, bookmarks: t.bookmarks ?? undefined, lastFetchedAt: new Date() } : {}) },
            });
            ids.push(row.id); n++;
          }
          const newest = [cur?.newest_id, page.newestId, ...page.posts.map((p) => p.id)].filter((v): v is string => !!v).reduce((a, b) => BigInt(a) > BigInt(b) ? a : b, "0");
          for (let offset = 0; offset < ids.length; offset += c.ingestBatchSize)
            await queueEvent(ctx, `posts:${c.xSource}:${p.id}:${cur?.page_token ?? "first"}:${newest}:${offset}`, "post.ingested", { postIds: ids.slice(offset, offset + c.ingestBatchSize), platform: PLATFORM_X, ingestedAt: new Date().toISOString() });
          const since = page.nextToken ? cur?.since_id ?? null : newest !== "0" ? newest : cur?.since_id ?? null;
          await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.cursors)} (person_id,source,since_id,page_token,newest_id,last_run_at) VALUES ($1,$2,$3,$4,$5,now())
            ON CONFLICT (person_id) DO UPDATE SET source=$2,since_id=$3,page_token=$4,newest_id=$5,last_run_at=now()`, p.id, c.xSource, since, page.nextToken ?? null, page.nextToken ? newest : null);
          cur = { person_id: p.id, source: c.xSource, since_id: since, page_token: page.nextToken ?? null, newest_id: newest, last_run_at: new Date() };
          if (!page.nextToken) break;
          if (i === c.xMaxPagesPerPerson - 1) pending.push(p.id);
        }
      } catch (e) {
        failed.push({ personId: p.id, error: message(e) });
        if (e instanceof HttpError && e.status === 400 && cur?.page_token)
          await ctx.db.query(`UPDATE ${ctx.db.t(OWN.cursors)} SET page_token=null,newest_id=null WHERE person_id=$1`, p.id);
        if (e instanceof AppError && e.code === "X_BUDGET_EXHAUSTED") break;
      }
    }
    await recordRun(ctx, "posts", dayIn(c.tz), { source: c.xSource, failed, pending, people: people.length, fetchedAt: new Date().toISOString() }, !failed.length && !pending.length, n);
    await flushOutbox(ctx);
    if (failed.length) throw new Error(`部分 X 账号采集失败，已保存成功页与断点：${JSON.stringify(failed)}`);
    return { posts: n, pendingPeople: pending };
  });
}

/** 仅回抓 X 人物池；窗口外冻结，不拿其他平台 ID 查询 X。 */
export async function refetchMetrics(ctx: ModuleContext) {
  const c = await loadConfig(ctx);
  if (c.xSource === "disabled") return { refetched: 0, skipped: "not_configured" };
  return withRunLock(ctx, "social", c.runLockTtlMs, async (check) => {
    await flushOutbox(ctx); const x = makeXSource(ctx, c);
    const platform = await ctx.db.core.platform.findUnique({ where: { name: PLATFORM_X } });
    if (!platform?.enabled) return { refetched: 0, skipped: "platform_disabled" };
    const now = new Date(); const from = new Date(dayStartMs(addDays(dayIn(c.tz, now), -c.refetchDays), c.tz));
    await ctx.db.core.post.updateMany({ where: { platformId: platform.id, frozen: false, postedAt: { lt: from } }, data: { frozen: true } });
    const live = await ctx.db.core.post.findMany({ where: { platformId: platform.id, frozen: false, person: { enabled: true }, postedAt: { gte: from, lte: now } }, select: { id: true, platformPostId: true, postedAt: true } });
    const valid = live.filter((p) => /^\d+$/.test(p.platformPostId));
    const missing: string[] = live.filter((p) => !/^\d+$/.test(p.platformPostId)).map((p) => p.platformPostId);
    const failed: string[] = []; const days = new Set<string>(); let n = 0;
    for (let i = 0; i < valid.length; i += c.xLookupBatch) {
      const chunk = valid.slice(i, i + c.xLookupBatch);
      try {
        const metrics = await x.lookup(chunk.map((p) => p.platformPostId)); const found = new Set(metrics.map((p) => p.id));
        missing.push(...chunk.filter((p) => !found.has(p.platformPostId)).map((p) => p.platformPostId));
        for (const m of metrics) {
          const p = chunk.find((q) => q.platformPostId === m.id); if (!p) continue; check();
          if (m.views == null && m.bookmarks == null) { missing.push(m.id); continue; }
          await ctx.db.core.post.updateMany({ where: { id: p.id, frozen: false }, data: { views: m.views ?? undefined, bookmarks: m.bookmarks ?? undefined, lastFetchedAt: now } });
          days.add(dayIn(c.tz, p.postedAt)); n++;
        }
      } catch (e) { failed.push(message(e)); if (e instanceof AppError && e.code === "X_BUDGET_EXHAUSTED") break; }
    }
    if (days.size) {
      const dates = [...days].sort();
      await queueEvent(ctx, `metrics:${dayIn(c.tz)}`, "recalc.requested", { reason: "mention_changed", dateFrom: dates[0], dateTo: dates[dates.length - 1] });
    }
    await recordRun(ctx, "metrics", dayIn(c.tz), { source: c.xSource, failed, missing, fetchedAt: now.toISOString() }, !failed.length && !missing.length, n);
    await flushOutbox(ctx);
    if (failed.length) throw new Error(`部分指标回抓失败：${failed.join("; ")}`);
    return { refetched: n, missing: missing.length };
  });
}

export async function collectMarket(ctx: ModuleContext, dateArg?: unknown) {
  const c = await loadConfig(ctx);
  if (dateArg != null && (typeof dateArg !== "string" || !isValidDay(dateArg))) throw new AppError(400, "BAD_INPUT", "date 需为 YYYY-MM-DD");
  const date = (dateArg as string | undefined) ?? addDays(dayIn(c.tz), c.marketDateOffsetDays);
  const at = { date, tz: c.tz, concurrency: c.marketConcurrency };
  try { bounds(at); } catch (e) { throw new AppError(400, "BAD_INPUT", message(e)); }
  return withRunLock(ctx, `market:${date}`, c.runLockTtlMs, async (check) => {
    await flushOutbox(ctx);
    const projects = await ctx.db.core.project.findMany({ select: { id: true, symbol: true, coingeckoId: true } });
    const exchanges = await ctx.db.core.exchange.findMany({ where: { enabled: true, name: { in: c.exchanges } } });
    const mappings = await ctx.db.query<AssetMapping>(`SELECT * FROM ${ctx.db.t(OWN.assets)}`);
    const vs = c.marketSource === "mock" ? mockVolumeSources(c.exchanges) : liveVolumeSources({ binance: c.binanceBaseUrl, okx: c.okxBaseUrl, bybit: c.bybitBaseUrl }, { ...http(c), rateLimitPerMin: c.marketRateLimitPerMin }, (source) => claimRateSlot(ctx, `market:${source}`, c.marketRateLimitPerMin));
    const day = dbDate(date); const failed: string[] = []; const sources: unknown[] = [];
    for (const ex of exchanges) {
      const { chosen, blocked } = resolveAssets(projects, mappings, ex.id); const src = vs[ex.name];
      let volumes: Awaited<ReturnType<typeof src.spotVolumesUsd>> | undefined;
      try { if (!src) throw new Error("没有该交易所适配器"); volumes = await src.spotVolumesUsd([...new Set(chosen.values())], c.usdQuotes, at); }
      catch (e) { failed.push(`${ex.name}: ${message(e)}`); }
      const unavailable: number[] = [];
      for (const p of projects) {
        check(); const base = chosen.get(p.id); const v = base ? volumes?.get(base) : undefined;
        const sourceError = base ? volumes?.failures.get(base) : undefined;
        if (sourceError) failed.push(`${ex.name}/${base}: ${sourceError}`);
        const where = { projectId_exchangeId_day: { projectId: p.id, exchangeId: ex.id, day } };
        const source = c.marketSource === "mock" ? "mock" : `exchange:${ex.name}:${base ?? "unmapped"}:${[...c.usdQuotes].sort().join(",")}:${c.tz}`;
        // 已验证的完整历史日不会因为重复请求临时失败而丢失；换资产/口径时旧值无效。
        if (v == null && base) {
          const previous = await ctx.db.core.volumeSnapshot.findUnique({ where });
          if (previous?.source === source && previous.spotVolumeUsd24h != null) continue;
        }
        if (volumes && base && v == null && !sourceError) {
          // 未上线或此区间不存在，清除旧的错误映射行，不伪造零成交额。
          await ctx.db.core.volumeSnapshot.deleteMany({ where: { projectId: p.id, exchangeId: ex.id, day } }); unavailable.push(p.id); continue;
        }
        await ctx.db.core.volumeSnapshot.upsert({ where, create: { projectId: p.id, exchangeId: ex.id, day, spotVolumeUsd24h: v ?? null, source }, update: { spotVolumeUsd24h: v ?? null, source, fetchedAt: new Date() } });
      }
      sources.push({ exchange: ex.name, status: volumes ? volumes.failures.size ? "partial" : "ok" : "failed", ambiguousProjectIds: blocked, unavailableProjectIds: unavailable });
    }
    const ps = c.marketSource === "mock" ? mockPriceSource : livePriceSource(c.coingeckoBaseUrl, { ...http(c), rateLimitPerMin: c.coingeckoRateLimitPerMin, beforeAttempt: () => claimRateSlot(ctx, "coingecko", c.coingeckoRateLimitPerMin) }, ctx.config.env("COINGECKO_API_KEY") ?? process.env.COINGECKO_API_KEY, c.coingeckoApiKeyType, c.coingeckoBatchSize);
    let prices: Awaited<ReturnType<typeof ps.pricesUsd>> | undefined;
    try { prices = await ps.pricesUsd(projects.flatMap((p) => p.coingeckoId ? [p.coingeckoId] : []), at); }
    catch (e) { failed.push(`coingecko: ${message(e)}`); }
    for (const p of projects) {
      check(); const id = p.coingeckoId; const sourceError = id ? prices?.failures.get(id) : undefined;
      if (sourceError) failed.push(`coingecko/${id}: ${sourceError}`);
      const value = id ? prices?.get(id) ?? null : null; const source = c.marketSource === "mock" ? "mock" : `coingecko:${id ?? "unmapped"}:${c.tz}`;
      const where = { projectId_day: { projectId: p.id, day } };
      if (value == null && id) {
        const previous = await ctx.db.core.priceSnapshot.findUnique({ where });
        if (previous?.source === source && previous.priceUsd != null) continue;
      }
      await ctx.db.core.priceSnapshot.upsert({ where, create: { projectId: p.id, day, priceUsd: value, source }, update: { priceUsd: value, source, fetchedAt: new Date() } });
    }
    const missingPriceIds = projects.filter((p) => !p.coingeckoId).map((p) => p.id);
    const detail = { source: c.marketSource, interval: { from: new Date(dayStartMs(date, c.tz)).toISOString(), to: new Date(dayStartMs(addDays(date, 1), c.tz)).toISOString() }, fetchedAt: new Date().toISOString(), sources, missingPriceIds, failed };
    // 即使部分源失败，也把有效数据和缺失状态同步给日批；失败源继续进入队列重试。
    await queueEvent(ctx, `market:${date}`, "market.snapshot.ingested", { date });
    await recordRun(ctx, "market", date, detail, !failed.length, projects.length);
    await flushOutbox(ctx);
    if (failed.length) throw new Error(`行情部分失败 ${date}，状态已保存：${failed.join("; ")}`);
    return { date, exchanges: exchanges.length, projects: projects.length, priceSkipped: missingPriceIds.length, emitted: true };
  });
}
