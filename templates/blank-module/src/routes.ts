import type { ModuleContext } from "@app/core";
export function registerRoutes(ctx: ModuleContext) {
  const { router, db } = ctx;
  router.get("/items", async () => db.query(`SELECT id, title, created_at FROM ${db.t("items")} ORDER BY id DESC LIMIT 100`));
  router.post("/items", { preHandler: ctx.requirePermission("__NAME__:write") }, async (req) => {
    const [row] = await db.query(`INSERT INTO ${db.t("items")} (title) VALUES ($1) RETURNING id, title`, String((req.body as any)?.title ?? ""));
    await ctx.audit({ action: "create", table: db.t("items"), recordId: row.id, after: row, actorId: req.user?.id });
    return row;
  });
}
