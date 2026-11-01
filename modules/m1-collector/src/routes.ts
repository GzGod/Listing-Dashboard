import { AppError, type ModuleContext } from "@app/core";
import { collectMarket, collectPosts, refetchMetrics } from "./collector.js";
import { loadConfig, OWN } from "./config.js";

export const PERMS = { run: "m1-collector:run" } as const;
const positiveId = (v: unknown) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, "BAD_INPUT", "需提供正整数 ID"); return n; };
export function registerRoutes(ctx: ModuleContext) {
  const { router, db } = ctx; const pre = { preHandler: ctx.requirePermission(PERMS.run) };
  router.get("/status", pre, async () => ({
    cursors: await db.query(`SELECT * FROM ${db.t(OWN.cursors)} ORDER BY person_id`),
    runs: await db.query(`SELECT kind, day::text, count, done, detail, updated_at FROM ${db.t(OWN.runs)} ORDER BY updated_at DESC LIMIT 30`),
    pendingEvents: (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${db.t(OWN.outbox)} WHERE sent=false`))[0]?.n ?? 0,
  }));
  router.get("/sources", pre, async () => {
    const c = await loadConfig(ctx);
    const [projects, exchanges, people] = await Promise.all([
      db.core.project.findMany({ select: { id: true, name: true, symbol: true, coingeckoId: true } }),
      db.core.exchange.findMany({ select: { id: true, name: true, enabled: true } }),
      db.core.person.count({ where: { enabled: true, platform: { name: "X", enabled: true } } }),
    ]);
    return { config: c, projects, exchanges, sources: [
      { id: "x", name: "X 社交帖子", mode: c.xSource, status: c.xSource === "disabled" ? "未接入" : c.xSource === "mock" ? "演示数据" : (ctx.config.env("X_BEARER_TOKEN") ?? process.env.X_BEARER_TOKEN) ? "已配置" : "缺少密钥", detail: `人物池 ${people} 人；按分页断点采集；发帖后 ${c.refetchDays} 天内回抓指标` },
      { id: "market", name: "交易所现货成交额", mode: c.marketSource, status: c.marketSource === "mock" ? "演示数据" : "公开接口", detail: `覆盖 ${c.exchanges.join("、")}；按完整日统计 USD / USDT / USDC 计价现货` },
      { id: "price", name: "CoinGecko 币价", mode: c.marketSource, status: c.marketSource === "mock" ? "演示数据" : "公开接口", detail: `已配置币种 ID ${projects.filter((p) => p.coingeckoId).length}/${projects.length}；历史币价不使用实时值补齐` },
      { id: "lumina", name: "老 Lumina", mode: "placeholder", status: "待接入", detail: "预留声量历史数据入口，等待数据格式与样本" },
      { id: "research", name: "龙哥研究系统", mode: "placeholder", status: "待接入", detail: "预留基本面、评级、赛道与运营数据入口；当前由后台手动录入" },
      { id: "listings", name: "上币事件", mode: "manual", status: "手动录入", detail: "按 PRD MVP，在项目与上币页面维护日期、交易所、阶段、交易对和公告链接" },
    ] };
  });
  router.get("/asset-mappings", pre, async () => db.query(`SELECT * FROM ${db.t(OWN.assets)} ORDER BY exchange_id,project_id`));
  router.put("/asset-mappings", pre, async (req) => {
    const body = req.body as any; const projectId = positiveId(body?.projectId); const exchangeId = positiveId(body?.exchangeId);
    const symbol = typeof body?.baseSymbol === "string" ? body.baseSymbol.trim().toUpperCase() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!/^[A-Z0-9._-]{1,40}$/.test(symbol) || !note || note.length > 1000) throw new AppError(400, "BAD_INPUT", "请填写有效的交易所基础币符号和确认依据（最多 1000 字）");
    const [project, exchange] = await Promise.all([db.core.project.findUnique({ where: { id: projectId } }), db.core.exchange.findUnique({ where: { id: exchangeId } })]);
    if (!project || !exchange) throw new AppError(404, "NOT_FOUND", "项目或交易所不存在");
    const before = await db.query(`SELECT * FROM ${db.t(OWN.assets)} WHERE project_id=$1 AND exchange_id=$2`, projectId, exchangeId);
    let rows;
    try { rows = await db.query(`INSERT INTO ${db.t(OWN.assets)} (project_id,exchange_id,base_symbol,note) VALUES ($1,$2,$3,$4)
      ON CONFLICT (project_id,exchange_id) DO UPDATE SET base_symbol=$3,note=$4,updated_at=now() RETURNING *`, projectId, exchangeId, symbol, note); }
    catch (e: any) { if (e?.meta?.code === "23505" || e?.code === "23505") throw new AppError(409, "ASSET_CONFLICT", "该交易所资产已绑定其他项目，请核对身份"); throw e; }
    await ctx.audit({ action: "asset_mapping.save", table: db.t(OWN.assets), recordId: `${projectId}:${exchangeId}`, before: before[0] ?? null, after: rows[0], actorId: req.user?.id });
    return rows[0];
  });
  router.delete("/asset-mappings/:projectId/:exchangeId", pre, async (req) => {
    const p = req.params as any; const projectId = positiveId(p.projectId); const exchangeId = positiveId(p.exchangeId);
    const rows = await db.query(`DELETE FROM ${db.t(OWN.assets)} WHERE project_id=$1 AND exchange_id=$2 RETURNING *`, projectId, exchangeId);
    await ctx.audit({ action: "asset_mapping.delete", table: db.t(OWN.assets), recordId: `${projectId}:${exchangeId}`, before: rows[0] ?? null, actorId: req.user?.id });
    return { ok: true };
  });
  router.post("/run/posts", pre, async (req) => { const r = await collectPosts(ctx); await ctx.audit({ action: "run", table: "posts", after: r, actorId: req.user?.id }); return r; });
  router.post("/run/refetch", pre, async (req) => { const r = await refetchMetrics(ctx); await ctx.audit({ action: "run.refetch", table: "posts", after: r, actorId: req.user?.id }); return r; });
  router.post("/run/market", pre, async (req) => { const r = await collectMarket(ctx, (req.body as any)?.date); await ctx.audit({ action: "run.market", table: "volume_snapshots", after: r, actorId: req.user?.id }); return r; });
}
