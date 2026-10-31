import type { ModuleContext } from "@app/core";
export function registerRoutes(ctx: ModuleContext) {
  const { router, db } = ctx;
  router.get("/notes", async () => db.query(`SELECT id, text, source, created_at FROM ${db.t("notes")} ORDER BY id DESC LIMIT $1`, await ctx.config.get<number>("example.pageSize")));
  router.post("/notes", { preHandler: ctx.requirePermission("example:write") }, async (req) => {
    const text = String((req.body as any)?.text ?? "").trim() || "空笔记";
    const [row] = await db.query(`INSERT INTO ${db.t("notes")} (text, created_by) VALUES ($1, $2) RETURNING id, text, source, created_at`, text, req.user?.id ?? null);
    await ctx.audit({ action: "create", table: db.t("notes"), recordId: row.id, after: row, actorId: req.user?.id }); // 一行写审计
    return row;
  });
  router.post("/emit", { preHandler: ctx.requirePermission("example:write") }, async () => {
    await ctx.events.emit("recalc.requested", { reason: "manual_adjust", dateFrom: yesterday(), dateTo: yesterday() });
    return { ok: true };
  });
  router.get("/notes/:id", async (req) => (await db.query(`SELECT id, text, source, created_at FROM ${db.t("notes")} WHERE id = $1`, Number((req.params as any).id)))[0] ?? null);
  // ctx.redis：key 自动带 m:example: 前缀；Redis 挂了只返回本接口的错误
  router.post("/hits", async () => ({ hits: await ctx.redis.incr("hits") }));
  // 读核心表（只读）
  router.get("/projects-count", async () => ({ count: await db.core.project.count() }));
}

function yesterday() { const d = new Date(Date.now() - 864e5); return d.toISOString().slice(0, 10); }
