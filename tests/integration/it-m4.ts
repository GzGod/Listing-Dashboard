// M4 集成测试：真 Postgres（embedded-postgres，端口 55440）+ 真 ModuleHost/Fastify + 进程内事件总线（不需要 Redis）。
// 用法（在底座副本根目录，不改底座）：
//   1) 起库：pg_ctl -D <dir> -o "-p 55440" start；DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/m4it
//   2) pnpm db:migrate && pnpm db:seed
//   3) 把 m4-admin（和可选的 m2-matcher）放进 modules/，pnpm install（本文件放在模块目录外：pnpm check 禁止模块目录里出现 @app/db 直连）
//   4) cp /workspace/m4-admin-it/it-m4.ts scripts/ && CONFIG_CACHE_MS=0 npx tsx scripts/it-m4.ts
import fs from "node:fs"; import path from "node:path";
import Fastify from "fastify";
import { getPrisma } from "@app/db";
import { ModuleHost, installErrorHandler, EventBus } from "@app/core";

const db = getPrisma(); let bad = 0; const results: string[] = [];
const ok = (n: string, c: boolean, x?: unknown) => { if (!c) bad++; const line = `${c ? "✅" : "❌"} ${n}${x !== undefined ? "  " + JSON.stringify(x).slice(0, 220) : ""}`; results.push(line); console.log(line); };
class LocalBus extends EventBus {
  h = new Map<string, ((p: any, m: any) => any)[]>(); log2: [string, any][] = [];
  override on(e: string, _o: string, fn: any) { this.h.set(e, [...(this.h.get(e) ?? []), fn]); }
  override async emit(e: string, p: any, from = "core") { this.log2.push([e, p]); for (const f of this.h.get(e) ?? []) await f(p, { event: e, from, at: "", id: "" }); return { id: "x", deliveredTo: [] } as any; }
}
const setCfg = (k: string, v: unknown) => { process.env["CONFIG_" + k.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[.-]/g, "_").toUpperCase()] = JSON.stringify(v); };

/** 用符号链接挑选要加载的模块（真实目录在 modules/ 下，依赖解析正常） */
function modsDir(names: string[]) {
  const d = path.resolve(".it-mods-" + names.join("+"));
  fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d);
  for (const n of names) fs.symlinkSync(path.resolve("modules", n), path.join(d, n));
  return d;
}
async function boot(names: string[]) {
  const bus = new LocalBus(); const app = Fastify(); installErrorHandler(app);
  const host = new ModuleHost({ role: "server", app, db, modulesDir: modsDir(names), bus });
  host.auth.install(app, [/^\/api\/_core\/(auth\/login|health)$/]);
  await host.boot(); await app.ready();
  const login = async (email: string) => ({ authorization: `Bearer ${(await app.inject({ method: "POST", url: "/api/_core/auth/login", payload: { email, password: "admin123" } })).json().token}` });
  return { app, bus, host, A: await login("admin@local"), V: await login("viewer@local") };
}
const tz = process.env.CONFIG_TIME_DAY_CUT_TIMEZONE ? JSON.parse(process.env.CONFIG_TIME_DAY_CUT_TIMEZONE) : "UTC";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const recalcs = (bus: LocalBus) => bus.log2.filter(([e]) => e === "recalc.requested").map(([, p]) => p);

// 预清理（上次中断留下的测试数据）
await db.buzzAdjustment.deleteMany({ where: { reason: { in: ["刷量剔除", "再调", "上线前补录", "撤销"] } } });
await db.person.deleteMany({ where: { handle: "it_kol" } }); await db.project.deleteMany({ where: { OR: [{ name: "IT Proj" }, { name: { endsWith: " Twin" } }] } });
await db.track.deleteMany({ where: { name: "IT Unused" } });
await db.scoreParams.deleteMany({ where: { effectiveFrom: new Date("2026-10-01") } }); await db.kolTier.deleteMany({ where: { effectiveFrom: new Date("2026-10-15") } });

await db.$executeRawUnsafe(`DELETE FROM m_m4_admin_mock_review`).catch(() => {}); // 让 register 重新塞假数据（测试脚本，不是模块代码）

// ============ 阶段 1：只装 m4-admin（M2 不在 → auto 退回假数据 / off 返回 502）============
setCfg("m4-admin.m2Mock", "auto");
{
  const { app, bus, A, V } = await boot(["m4-admin"]);
  const I = (method: string, url: string, payload?: unknown, h = A) => app.inject({ method: method as any, url: "/api/m4-admin" + url, headers: h, ...(payload !== undefined ? { payload: payload as any } : {}) });
  const mods = (await app.inject({ url: "/api/_core/modules", headers: A })).json().modules;
  ok("m4-admin started", mods.length === 1 && mods[0].status === "started", mods.map((m: any) => `${m.name}:${m.status}:${m.error ?? ""}`));
  const menu = (await app.inject({ url: "/api/_core/menu", headers: A })).json();
  ok("后台菜单 7 项", JSON.stringify(menu).split("AD-0").length - 1 >= 7);
  const auditStartId = (await db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0n;

  // ---- AD-01 项目：赛道必填、必填校验 400 ----
  const tracks = await db.track.findMany({ where: { parentId: { not: null } } });
  let r = await I("POST", "/projects", { name: "IT Proj", symbol: "ITP" });
  ok("新建项目不带赛道 → 400", r.statusCode === 400 && /赛道/.test(r.body), r.json());
  r = await I("POST", "/projects", { name: "IT Proj", trackId: tracks[0].id });
  ok("缺 symbol → 400 且提示字段", r.statusCode === 400 && /symbol/.test(r.body), r.json());
  r = await I("POST", "/projects", { name: "IT Proj", symbol: "ITP", trackId: 999999 });
  ok("不存在的赛道 → 400", r.statusCode === 400, r.json());
  r = await I("POST", "/projects", { name: "IT Proj", symbol: "ITP", trackId: tracks[0].id, coingeckoId: "it-proj", fundamentals: { summary: "x", capTable: [{ holder: "team", pct: 20 }] }, team: [{ name: "A", role: "CEO" }], revenuePeriod: "30d", revenueUsd: "1234.5", usersAsOf: "2026-10-01" });
  ok("新建项目（全字段）200", r.statusCode === 200, r.json());
  const pid = r.json().id;
  r = await I("POST", "/projects", { name: "Bad", symbol: "B", trackId: tracks[0].id, fundamentals: { capTable: [{ holder: "x", pct: 500 }] } });
  ok("fundamentals 不合 schema → 400", r.statusCode === 400, r.json());
  r = await I("PUT", `/projects/${pid}`, { trackId: null });
  ok("编辑时清空赛道 → 400", r.statusCode === 400);
  r = await I("PUT", `/projects/${pid}`, { trackId: tracks[1].id, symbol: "ITP2" });
  ok("改赛道只改 projects.track_id", r.statusCode === 200 && r.json().trackId === tracks[1].id);
  r = await I("PUT", `/projects/${pid}`, { symbol: "" });
  ok("编辑时 symbol 置空 → 400", r.statusCode === 400);
  r = await I("PUT", `/projects/99999999`, { name: "x" });
  ok("编辑不存在 → 404", r.statusCode === 404);
  r = await I("POST", "/projects", "not-json-object" as any);
  ok("非对象请求体 → 400（不是 500）", r.statusCode === 400 || r.statusCode === 415, r.statusCode);
  r = await I("POST", "/contracts", { projectId: pid, chain: "eth" });
  ok("合约缺 address → 400", r.statusCode === 400, r.json());
  r = await I("POST", "/contracts", { projectId: pid, chain: "eth", address: "0xit" });
  ok("合约新建 200", r.statusCode === 200);
  r = await I("POST", "/contracts", { projectId: pid, chain: "eth", address: "0xit" });
  ok("重复合约 → 409", r.statusCode === 409, r.json());
  const ex = await db.exchange.findFirst();
  r = await I("POST", "/listings", { projectId: pid, exchangeId: ex!.id, day: "2026-10-30", stage: "moon" });
  ok("上币阶段非法 → 400", r.statusCode === 400);
  r = await I("POST", "/listings", { projectId: pid, exchangeId: ex!.id, day: "2026-13-01", stage: "spot" });
  ok("上币日期非法 → 400", r.statusCode === 400, r.json());
  r = await I("POST", "/listings", { projectId: pid, exchangeId: ex!.id, day: "2026-10-30", stage: "spot", pair: "ITP/USDT" });
  ok("上币事件新建 200（exchange_id）", r.statusCode === 200 && r.json().exchangeId === ex!.id);
  r = await I("POST", "/projects", { name: "V", symbol: "V", trackId: tracks[0].id }, V);
  ok("viewer 写 → 403", r.statusCode === 403);

  // ---- AD-02 人物/标签 ----
  const pf = await db.platform.findFirst();
  r = await I("POST", "/people", { displayName: "IT KOL", platformId: pf!.id });
  ok("人物缺 handle → 400", r.statusCode === 400);
  r = await I("POST", "/people", { displayName: "IT KOL", handle: "it_kol", platformId: pf!.id, kolTier: "A" });
  ok("人物新建 200（kol_tier 存等级名）", r.statusCode === 200 && r.json().kolTier === "A");
  const personId = r.json().id;
  r = await I("POST", "/person-tags", { personId, tag: "top_kol" });
  ok("标签新建 200", r.statusCode === 200);

  // ---- AD-05 别名 ----
  r = await I("POST", "/aliases", { projectId: pid, alias: "itp" });
  ok("别名缺 kind → 400", r.statusCode === 400 && /kind/.test(r.body));
  r = await I("POST", "/aliases", { projectId: pid, alias: "itp", kind: "weird" });
  ok("别名 kind 非法 → 400", r.statusCode === 400);
  r = await I("POST", "/aliases", { projectId: pid, alias: "itp", kind: "name" });
  ok("别名新建 200", r.statusCode === 200);
  r = await I("POST", "/aliases", { projectId: pid, alias: "itp", kind: "name" });
  ok("重复别名 → 409", r.statusCode === 409);

  // ---- AD-07 赛道：删除规则 ----
  r = await I("POST", "/tracks", { name: "IT Unused" });
  const unused = r.json().id;
  r = await I("DELETE", `/tracks/${unused}`);
  ok("没用过的赛道可删除", r.statusCode === 200);
  const used = (await db.project.findFirst({ where: { trackId: { not: null } } }))!.trackId!;
  r = await I("DELETE", `/tracks/${used}`);
  ok("被项目/快照使用的赛道删除 → 409", r.statusCode === 409 && r.json().error.message === "该赛道已被使用，不能删除，请改用停用", r.json());
  const parentUsed = (await db.track.findFirst({ where: { parentId: null } }))!.id;
  r = await I("DELETE", `/tracks/${parentUsed}`);
  ok("有子赛道的一级赛道删除 → 409", r.statusCode === 409);
  r = await I("POST", "/tracks", {});
  ok("赛道缺 name → 400", r.statusCode === 400);
  const feat = (await I("GET", "/tracks/features")).json();
  ok("停用功能按 disabled_at 列自动开关（当前底座无此列 → false）", feat.disable === false, feat);
  r = await I("POST", `/tracks/${used}/disable`);
  ok("无 disabled_at 时停用 → 501", r.statusCode === 501);

  // ---- AD-03 权重版本 + 事件 ----
  bus.log2.length = 0;
  r = await I("POST", "/score-params", { a: 2, b: 6, effectiveFrom: "2026-10-01" });
  ok("score_params 新版本 200", r.statusCode === 200, r.json().params?.version ?? r.json());
  let ev = recalcs(bus);
  ok("保存发 weights_changed：生效日 → 今天（切日时区）", ev.length === 1 && ev[0].reason === "weights_changed" && ev[0].dateFrom === "2026-10-01" && ev[0].dateTo === today && Object.keys(ev[0]).sort().join() === "dateFrom,dateTo,reason", ev);
  r = await I("POST", "/score-params", { a: "", b: 1 });
  ok("score_params 缺 a → 400", r.statusCode === 400);
  const hist = (await I("GET", "/score-params")).json();
  ok("score_params 版本历史 ≥2", hist.length >= 2);
  bus.log2.length = 0;
  r = await I("POST", "/kol-tiers/versions", { effectiveFrom: "2026-10-15", weights: { S: 4, A: 2, B: 1 } });
  ok("kol_tiers 新版本（一整套等级）200", r.statusCode === 200 && r.json().rows.length === 3, r.json().version);
  ev = recalcs(bus);
  ok("kol 保存发 weights_changed 生效日 → 今天", ev.length === 1 && ev[0].reason === "weights_changed" && ev[0].dateFrom === "2026-10-15" && ev[0].dateTo === today, ev);
  const cur = (await I("GET", "/kol-tiers")).json();
  ok("当前生效 KOL 版本 = 新版本", cur?.weights?.S === 4, cur);
  bus.log2.length = 0;
  r = await I("POST", "/backfill", { dateFrom: "2026-10-01", dateTo: "2026-10-05", projectIds: [pid] });
  ev = recalcs(bus);
  ok("手动回算发 manual_backfill，projectIds 为 number[]", r.statusCode === 200 && ev[0]?.reason === "manual_backfill" && ev[0].projectIds[0] === pid && typeof ev[0].projectIds[0] === "number", ev);
  r = await I("POST", "/backfill", { dateFrom: "2026-10-05", dateTo: "2026-10-01" });
  ok("回算日期倒置 → 400", r.statusCode === 400);

  // ---- AD-04 调分 ----
  const snap = await db.buzzSnapshot.findFirst({ where: { rawTotal: { not: null } }, orderBy: { day: "desc" } });
  const sd = snap!.day.toISOString().slice(0, 10);
  bus.log2.length = 0;
  r = await I("POST", "/adjustments", { projectId: snap!.projectId, day: sd, adjustedScore: 88 });
  ok("有快照、缺理由 → 400", r.statusCode === 400);
  r = await I("POST", "/adjustments", { projectId: snap!.projectId, day: sd, adjustedScore: 88, reason: "刷量剔除" });
  ok("有快照调分 200（非补分）", r.statusCode === 200 && r.json().fill === false, r.json());
  r = await I("POST", "/adjustments", { projectId: snap!.projectId, day: sd, adjustedScore: 77, reason: "再调" });
  const active = await db.buzzAdjustment.count({ where: { projectId: snap!.projectId, day: snap!.day, revoked: false } });
  ok("同日再调：旧的撤销，只剩 1 条有效", r.statusCode === 200 && active === 1);
  ok("M4 不写 buzz_snapshots（原始分不变）", (await db.buzzSnapshot.findUnique({ where: { id: snap!.id } }))!.rawTotal === snap!.rawTotal);
  ev = recalcs(bus);
  ok("调分发 manual_adjust {projectIds:[id], dateFrom=dateTo=当天}", ev.length === 2 && ev.every((e) => e.reason === "manual_adjust" && e.dateFrom === sd && e.dateTo === sd && e.projectIds[0] === snap!.projectId), ev);
  bus.log2.length = 0;
  r = await I("POST", "/adjustments", { projectId: snap!.projectId, day: sd, adjustedScore: "", reason: "撤销" });
  ev = recalcs(bus);
  ok("撤销调分 200，全部 revoked", r.statusCode === 200 && (await db.buzzAdjustment.count({ where: { projectId: snap!.projectId, day: snap!.day, revoked: false } })) === 0);
  ok("撤销也发 manual_adjust（同项目同日）", ev.length === 1 && ev[0].reason === "manual_adjust" && ev[0].projectIds[0] === snap!.projectId && ev[0].dateFrom === sd && ev[0].dateTo === sd, ev);
  r = await I("POST", "/adjustments", { projectId: pid, day: "2026-01-01", adjustedScore: 50 });
  ok("无快照、无理由 → 400「当天无快照，补分须填写理由」", r.statusCode === 400 && r.json().error.message === "当天无快照，补分须填写理由", r.json());
  bus.log2.length = 0;
  r = await I("POST", "/adjustments", { projectId: pid, day: "2026-01-01", adjustedScore: 50, reason: "上线前补录" });
  ok("无快照补分 200（fill=true，buzz_snapshot_id 为空）", r.statusCode === 200 && r.json().fill === true && r.json().adjustment.buzzSnapshotId === null, r.json());
  ok("补分也发 manual_adjust", recalcs(bus)[0]?.reason === "manual_adjust");
  r = await I("POST", "/adjustments", { projectId: pid, day: "2026-02-30", adjustedScore: 1, reason: "x" });
  ok("非法日期 → 400", r.statusCode === 400);

  // ---- AD-06 无 M2：auto 退回假数据；off → 502 ----
  r = await I("GET", "/review-queue?status=pending");
  if (r.statusCode !== 200) console.log("DEBUG", r.statusCode, r.body);
  ok("M2 不在 + auto → 假数据", r.statusCode === 200 && r.json().source === "mock" && r.json().items[0]?.candidates?.[0]?.matchedText, r.json().items?.[0]);
  const mp = r.json().items[0].postId, mc = r.json().items[0].candidates[0].projectId;
  r = await I("POST", `/review/posts/${mp}`, { projectIds: [999] });
  ok("假数据：非候选 → 400", r.statusCode === 400);
  r = await I("POST", `/review/posts/${mp}`, { projectIds: [mc] });
  ok("假数据：按帖提交 200，响应同 M2 形状", r.statusCode === 200 && ["ok", "postId", "confirmed", "rejected", "updated", "dateFrom", "dateTo"].every((k) => k in r.json().result), r.json());
  r = await I("POST", `/review/posts/${mp}`, { projectIds: [] });
  ok("假数据：重复审核 → 404「该帖子已审核或不存在」", r.statusCode === 404 && r.json().error.message === "该帖子已审核或不存在");
  r = await I("POST", `/review/posts/${mp}`, { projectIds: "x" });
  ok("projectIds 非数组 → 400", r.statusCode === 400);
  setCfg("m4-admin.m2Mock", "off");
  r = await I("GET", "/review-queue");
  ok("M2 不可达 + off → 502", r.statusCode === 502, r.json());
  r = await I("POST", `/review/posts/1`, { projectIds: [] });
  ok("M2 不可达提交 + off → 502", r.statusCode === 502);
  setCfg("m4-admin.m2Mock", true);
  r = await I("GET", "/review-queue");
  ok("m2Mock 非法值（布尔）按 auto 处理", r.statusCode === 200 && r.json().source === "mock");
  setCfg("m4-admin.m2Mock", "auto");

  // ---- 审计 + tables.writes 一致性 ----
  const audits = await db.auditLog.findMany({ where: { module: "m4-admin", id: { gt: auditStartId } }, orderBy: { id: "asc" } });
  const acts = new Set(audits.map((a) => a.action));
  const need = ["create", "update", "delete", "activate", "kol_weights_version", "manual_backfill", "manual_adjust", "manual_adjust_revoke", "manual_adjust_fill", "review_submit_mock"];
  ok("每类成功写入都有审计（失败的请求不留审计）", need.every((a) => acts.has(a)) && audits.length >= 17, { n: audits.length, missing: need.filter((a) => !acts.has(a)) });
  const manifest = (await import(path.resolve("modules/m4-admin/module.manifest.ts"))).default;
  const declared = new Set([...(manifest.tables.writes ?? []), ...(manifest.tables.owns ?? [])]);
  const touched = new Set(audits.map((a) => a.table).filter((t): t is string => !!t && !t.includes("via m2")));
  const extra = [...touched].filter((t) => !declared.has(t));
  ok("实际写入的表 ⊆ tables.writes ∪ owns", extra.length === 0, { touched: [...touched], extra });
  const unusedDecl = [...declared].filter((t) => !touched.has(t));
  ok("声明了但本次没写到的表（仅提示）", true, unusedDecl);

  // 清理本阶段数据
  await db.buzzAdjustment.deleteMany({ where: { projectId: { in: [pid, snap!.projectId] }, reason: { in: ["刷量剔除", "再调", "上线前补录"] } } });
  await db.person.delete({ where: { id: personId } }); await db.project.delete({ where: { id: pid } });
  await db.scoreParams.deleteMany({ where: { effectiveFrom: new Date("2026-10-01") } }); await db.kolTier.deleteMany({ where: { effectiveFrom: new Date("2026-10-15") } });
  await app.close();
}

// ============ 阶段 2：m4-admin + 真 m2-matcher 联调 ============
if (fs.existsSync(path.resolve("modules/m2-matcher"))) {
  setCfg("m4-admin.m2Mock", "off");
  const { app, A } = await boot(["m4-admin", "m2-matcher"]);
  const I = (method: string, url: string, payload?: unknown) => app.inject({ method: method as any, url: "/api/m4-admin" + url, headers: A, ...(payload !== undefined ? { payload: payload as any } : {}) });
  const mods = (await app.inject({ url: "/api/_core/modules", headers: A })).json().modules.map((m: any) => `${m.name}:${m.status}`);
  ok("m4-admin + m2-matcher 都 started", mods.every((x: string) => x.endsWith(":started")), mods);
  // 扮演 M1：造一个重名 ticker 的帖子，让 M2 生成 pending 候选
  const base = await db.project.findFirst({ orderBy: { id: "asc" } });
  const dup = await db.project.create({ data: { name: base!.name + " Twin", symbol: base!.symbol, trackId: base!.trackId } });
  const person = await db.person.findFirst();
  const post = await db.post.create({ data: { personId: person!.id, platformId: person!.platformId, platformPostId: `it-m4-${Date.now()}`, postedAt: new Date(), url: "https://x.com/it/status/1", text: `$${base!.symbol} to the moon` } });
  const rm = await app.inject({ method: "POST", url: "/api/m2-matcher/rematch", headers: A, payload: { postIds: [post.id] } });
  ok("M2 rematch 200", rm.statusCode === 200, rm.json());
  let r = await I("GET", "/review-queue");
  const grp = r.json().items?.find((g: any) => g.postId === post.id);
  ok("经 M4 拿到真 M2 队列（source=m2，带 matchedText）", r.statusCode === 200 && r.json().source === "m2" && !!grp && grp.candidates.every((c: any) => c.matchedText), grp);
  r = await I("POST", `/review/posts/${post.id}`, { projectIds: [999999] });
  ok("真 M2：非候选 → 400 透传", r.statusCode === 400, r.json());
  r = await I("POST", `/review/posts/${post.id}`, { projectIds: [dup.id] });
  ok("真 M2：按帖提交 200，响应 {ok,postId,confirmed,rejected,updated,dateFrom,dateTo}", r.statusCode === 200 && r.json().source === "m2" && r.json().result.ok === true, r.json());
  const st = await db.postMention.findMany({ where: { postId: post.id } });
  ok("post_mentions 由 M2 改状态（勾选 confirmed，其余 rejected）", st.find((m) => m.projectId === dup.id)?.status === "confirmed" && st.filter((m) => m.projectId !== dup.id).every((m) => m.status === "rejected"), st.map((m) => `${m.projectId}:${m.status}`));
  r = await I("POST", `/review/posts/${post.id}`, { projectIds: [] });
  ok("真 M2：重复审核 → 404「该帖子已审核或不存在」", r.statusCode === 404 && r.json().error.message === "该帖子已审核或不存在", r.json());
  const ad = await db.auditLog.count({ where: { module: "m4-admin", action: "review_submit" } });
  ok("经 M2 提交也写 M4 审计", ad > 0);
  await db.postMention.deleteMany({ where: { postId: post.id } }); await db.post.delete({ where: { id: post.id } }); await db.project.delete({ where: { id: dup.id } });
  await app.close();
} else ok("（跳过）没有 modules/m2-matcher，未做真 M2 联调", true);

for (const d of fs.readdirSync(".")) if (d.startsWith(".it-mods-")) fs.rmSync(d, { recursive: true, force: true });
await db.$disconnect();
console.log(bad ? `\n${bad} 项失败` : "\n全部通过"); process.exit(bad ? 1 : 0);
