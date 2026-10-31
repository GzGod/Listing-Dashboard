import type { ModuleContext } from "@app/core";
import { collectMarket, collectPosts, refetchMetrics } from "./collector.js";
import { OWN } from "./config.js";

export const PERMS = { run: "m1-collector:run" } as const;
export function registerRoutes(ctx: ModuleContext) {
  const { router, db } = ctx; const pre = { preHandler: ctx.requirePermission(PERMS.run) };
  router.get("/status", async () => ({
    cursors: await db.query(`SELECT * FROM ${db.t(OWN.cursors)} ORDER BY person_id`),
    runs: await db.query(`SELECT kind, day::text, count, done, updated_at FROM ${db.t(OWN.runs)} ORDER BY day DESC LIMIT 30`),
  }));
  // 手动触发（定时任务也可用 POST /api/_core/jobs/m1-collector/<job>/run）
  router.post("/run/posts", pre, async (req) => { const r = await collectPosts(ctx); await ctx.audit({ action: "run", table: "posts", after: r, actorId: req.user?.id }); return r; });
  router.post("/run/refetch", pre, async () => refetchMetrics(ctx));
  router.post("/run/market", pre, async (req) => collectMarket(ctx, (req.body as any)?.date));
}
