// TEST_DATABASE_URL 指向测试 PostgreSQL；所有表在随机独立 schema 中创建，结束后只删除该 schema。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@app/db";
import { makeModuleDb, type ModuleContext } from "@app/core";
import { CONFIG_DEFAULTS } from "@app/shared";
import { DEFAULTS } from "../../modules/m1-collector/src/config.js";
import { collectMarket, collectPosts, refetchMetrics } from "../../modules/m1-collector/src/collector.js";
import { claimRateSlot, claimXCall, flushOutbox, queueEvent, withRunLock } from "../../modules/m1-collector/src/state.js";
import { computeDay } from "../../modules/m3-engine/src/engine.js";
import { m5m6 } from "@app/shared";
const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error("设置 TEST_DATABASE_URL 后运行；测试使用独立 schema，不触碰现有业务表");
const schema = "source_test_" + randomUUID().replace(/-/g, "");
const url = new URL(connection); url.searchParams.set("schema", schema);
const admin = new PrismaClient({ datasources: { db: { url: connection } } });
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const config: Record<string, unknown> = { ...CONFIG_DEFAULTS, ...Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => ["m1-collector." + k, v])), "m1-collector.marketSource": "mock", "m1-collector.marketRateLimitPerMin": 60000000, "m1-collector.coingeckoRateLimitPerMin": 60000000, "m1-collector.xRateLimitPerMin": 60000000, "m1-collector.httpRetryDelayMs": 0, "m1-collector.httpRetries": 1 };
const emitted: { event: string; payload: any }[] = [];
const ctx = {
  config: { get: async (key: string, fallback: unknown) => config[key] ?? fallback, env: (key: string) => key === "X_BEARER_TOKEN" ? "test-token" : undefined, scoreParams: async () => ({ version: "v1", a: 1, b: 1 }), kolTiers: async () => null },
  db: makeModuleDb(db, "m1-collector", ["posts", "volume_snapshots", "price_snapshots"]),
  events: { emit: async (event: string, payload: any) => { emitted.push({ event, payload }); } },
  log: { info() {}, warn() {}, debug() {}, error() {} },
} as unknown as ModuleContext;
let project: number, exchange: number, x: number, person: number;
const day = "2026-10-01";
before(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  // 单条语句与正式迁移执行器相同；核心表结构由底座迁移创建。
  for (const dir of ["packages/db/prisma/migrations", "modules/m1-collector/migrations"]) {
    const files = dir.includes("prisma") ? readdirSync(dir).filter((n) => /^\d/.test(n)).sort().map((n) => `${dir}/${n}/migration.sql`) : readdirSync(dir).filter((n) => n.endsWith(".sql")).sort().map((n) => `${dir}/${n}`);
    for (const file of files) for (const stmt of readFileSync(file, "utf8").split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      if (stmt.includes('CREATE SCHEMA IF NOT EXISTS "public"')) continue;
      await db.$executeRawUnsafe(stmt);
    }
  }
  const track = await db.track.create({ data: { name: "Test" } });
  project = (await db.project.create({ data: { name: "Bitcoin", symbol: "BTC", trackId: track.id, coingeckoId: "bitcoin" } })).id;
  exchange = (await db.exchange.create({ data: { name: "Binance", type: "CEX" } })).id;
  x = (await db.platform.create({ data: { name: "X" } })).id;
  person = (await db.person.create({ data: { handle: "alice", displayName: "Alice", platformId: x } })).id;
});
after(async () => { await db.$disconnect(); await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.$disconnect(); });

test("核心迁移保留真实 0，未知指标可存 NULL；前台契约允许缺失", async () => {
  const post = await db.post.create({ data: { personId: person, platformId: x, platformPostId: "1", postedAt: new Date(), url: "https://x.com/alice/status/1", views: 0 } });
  assert.equal(post.views, 0); assert.equal(post.bookmarks, null);
  m5m6.postsResponseSchema.parse({ items: [{ postId: post.id, url: post.url, platform: "X", postedAt: post.postedAt.toISOString(), views: post.views, bookmarks: null, author: { personId: person, name: "Alice", handle: "alice", kolTier: null, tags: [] }, matchType: "ticker" }], nextCursor: null });
});
test("并发任务租约互斥，抛错后可释放，X 预算并发不超额", async () => {
  let release!: () => void; let acquired!: () => void;
  const ready = new Promise<void>((r) => { acquired = r; });
  const held = withRunLock(ctx, "test", 1000, async () => { acquired(); await new Promise<void>((r) => { release = r; }); });
  await ready; await assert.rejects(withRunLock(ctx, "test", 1000, async () => {}), (e: any) => e.status === 409); release(); await held;
  await assert.rejects(withRunLock(ctx, "test", 1000, async () => { throw new Error("crash"); }));
  await withRunLock(ctx, "test", 1000, async () => {});
  const c = { ...DEFAULTS, refetchDays: 7, tz: "UTC", xDailyCap: 3 };
  const result = await Promise.allSettled(Array.from({ length: 8 }, () => claimXCall(ctx, c)));
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 3);
});
test("事件发出失败后可恢复；修订号避免 timestamp 精度导致重复投递", async () => {
  await queueEvent(ctx, "recover", "market.snapshot.ingested", { date: day });
  const emit = ctx.events.emit; ctx.events.emit = async () => { throw new Error("redis down"); };
  await assert.rejects(flushOutbox(ctx)); ctx.events.emit = emit;
  await flushOutbox(ctx);
  assert.equal((await ctx.db.query<{ n: number }>(`SELECT count(*)::int n FROM ${ctx.db.t("outbox")} WHERE sent=false`))[0].n, 0);
  const n = emitted.length; await flushOutbox(ctx); assert.equal(emitted.length, n);
});
test("不同任务上下文共享同一来源的请求速率", async () => {
  await claimRateSlot(ctx, "shared-rate-test", 600);
  const first = Date.now();
  await claimRateSlot({ ...ctx }, "shared-rate-test", 600);
  assert.ok(Date.now() - first >= 75);
});
test("分页上限保存断点且不推进增量游标，第二次运行补齐而不丢帖", async (t) => {
  config["m1-collector.xSource"] = "xapi"; config["m1-collector.xMaxPagesPerPerson"] = 1; config["m1-collector.xDailyCap"] = 100;
  t.mock.method(globalThis, "fetch", async (u: string) => {
    const url = new URL(u); if (url.pathname.includes("by/username")) return new Response(JSON.stringify({ data: { id: "42" } }));
    const second = url.searchParams.get("pagination_token") === "page2";
    assert.equal(url.searchParams.get("since_id"), null);
    return new Response(JSON.stringify({ data: [{ id: second ? "11" : "12", text: "$BTC", created_at: "2026-10-30T00:00:00Z", public_metrics: { impression_count: 0 } }], meta: second ? { newest_id: "11" } : { newest_id: "12", next_token: "page2" } }));
  });
  await collectPosts(ctx);
  let [cur] = await ctx.db.query(`SELECT * FROM ${ctx.db.t("cursors")} WHERE person_id=$1`, person);
  assert.equal(cur.since_id, null); assert.equal(cur.page_token, "page2");
  await collectPosts(ctx); [cur] = await ctx.db.query(`SELECT * FROM ${ctx.db.t("cursors")} WHERE person_id=$1`, person);
  assert.equal(cur.since_id, "12"); assert.equal(cur.page_token, null);
  assert.equal(await db.post.count({ where: { platformPostId: { in: ["11", "12"] } } }), 2);
  assert.equal((await db.post.findFirst({ where: { platformPostId: "12" } }))!.bookmarks, null);
});
test("非 X 平台不回抓，真实指标 0 保留且不会覆盖冻结历史", async (t) => {
  const other = await db.platform.create({ data: { name: "Other" } });
  const otherPerson = await db.person.create({ data: { handle: "other", displayName: "Other", platformId: other.id } });
  await db.post.create({ data: { personId: otherPerson.id, platformId: other.id, platformPostId: "99", postedAt: new Date(), url: "https://example.test/99", views: 123 } });
  const frozen = await db.post.create({ data: { personId: person, platformId: x, platformPostId: "88", postedAt: new Date("2026-01-01"), url: "https://x.com/alice/status/88", views: 99, frozen: true } });
  t.mock.method(globalThis, "fetch", async (u: string) => {
    const ids = new URL(u).searchParams.get("ids")!.split(","); assert.ok(!ids.includes("99") && !ids.includes("88"));
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id, public_metrics: { impression_count: 0, bookmark_count: 0 } })) }));
  });
  await refetchMetrics(ctx); assert.equal((await db.post.findUnique({ where: { id: frozen.id } }))!.views, 99);
  assert.equal((await db.post.findFirst({ where: { platformPostId: "99" } }))!.views, 123);
});
test("行情重复执行幂等，失败会清掉陈旧值且日批不排名；修复后能恢复", async (t) => {
  await collectMarket(ctx, day); await collectMarket(ctx, day);
  assert.equal(await db.volumeSnapshot.count({ where: { day: new Date(day), exchangeId: exchange } }), 1);
  assert.equal((await db.priceSnapshot.findFirst({ where: { day: new Date(day) } }))!.source, "mock");
  config["m1-collector.marketSource"] = "live";
  t.mock.method(globalThis, "fetch", async (u: string) => {
    const url = new URL(u);
    if (url.pathname.includes("coins")) return new Response(JSON.stringify({ market_data: { current_price: { usd: 100 } } }));
    return new Response(JSON.stringify({ code: -1 }), { status: 503 });
  });
  await assert.rejects(collectMarket(ctx, day));
  assert.equal((await db.volumeSnapshot.findFirst({ where: { day: new Date(day) } }))!.spotVolumeUsd24h, null);
  const engine = { ...ctx, db: makeModuleDb(db, "m3-engine", ["buzz_snapshots", "project_daily"]) } as ModuleContext;
  await computeDay(engine, day, day);
  assert.equal((await db.projectDaily.findUnique({ where: { projectId_day: { projectId: project, day: new Date(day) } } }))!.volumeTrackRank, null);
  config["m1-collector.marketSource"] = "mock"; await collectMarket(ctx, day); await computeDay(engine, day, day);
  assert.equal((await db.projectDaily.findUnique({ where: { projectId_day: { projectId: project, day: new Date(day) } } }))!.volumeTrackRank, 1);
});

test("历史重抓失败保留已验证值，来源身份改变时旧值不能继续计分", async (t) => {
  config["m1-collector.marketSource"] = "live"; let healthy = true;
  t.mock.method(globalThis, "fetch", async (u: string) => {
    if (!healthy) return new Response("{}", { status: 503 });
    const url = new URL(u); const start = Date.parse(day + "T00:00:00Z");
    const value = url.pathname.endsWith("exchangeInfo") ? { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }] }
      : url.pathname.endsWith("klines") ? [[start, 1, 2, 3, 4, 10, start + 86400000 - 1, 777]]
      : { market_data: { current_price: { usd: 100 } } };
    return new Response(JSON.stringify(value));
  });
  await collectMarket(ctx, day); healthy = false; await assert.rejects(collectMarket(ctx, day));
  assert.equal((await db.volumeSnapshot.findFirst({ where: { day: new Date(day) } }))!.spotVolumeUsd24h, 777);
  assert.equal((await db.priceSnapshot.findFirst({ where: { day: new Date(day) } }))!.priceUsd, 100);
  await db.project.update({ where: { id: project }, data: { symbol: "NEW", coingeckoId: "new-id" } });
  await assert.rejects(collectMarket(ctx, day));
  assert.equal((await db.volumeSnapshot.findFirst({ where: { day: new Date(day) } }))!.spotVolumeUsd24h, null);
  assert.equal((await db.priceSnapshot.findFirst({ where: { day: new Date(day) } }))!.priceUsd, null);
});
