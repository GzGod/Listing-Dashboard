// M3 计算引擎：每日声量分 S(p,T)、同日同赛道竞争排名。只写 buzz_snapshots、project_daily（整表）；前台查询接口归 M5M6。
import { defineModule } from "@app/core";
import { MODULE_NAME, CONFIG } from "./src/config.js";
import { runDaily, runRecalc } from "./src/engine.js";

export default defineModule({
  apiVersion: 1,
  name: MODULE_NAME,
  version: "0.4.1",
  displayName: "M3 计算引擎",
  requires: { core: "^1.1.0" },
  config: CONFIG.map((c) => ({ ...c, default: c.default as unknown })),
  tables: {
    reads: ["posts", "post_mentions", "people", "person_tags", "kol_tiers", "projects", "tracks", "volume_snapshots", "price_snapshots", "score_params", "buzz_adjustments"],
    writes: ["buzz_snapshots", "project_daily"],
    owns: [],
  },
  apis: [{ method: "POST", path: "/run", permission: "m3-engine:run", description: "手动触发日批 { date? }（运维用）" }],
  subscribes: ["post.ingested", "market.snapshot.ingested", "recalc.requested"],
  emits: ["daily.batch.done"],
  permissions: [{ key: "m3-engine:run", description: "手动触发计算", roles: ["admin"] }],
  jobs: [{ name: "daily", cronKey: "m3-engine.dailyCron", run: (ctx) => runDaily(ctx) }],
  register: async (ctx) => {
    ctx.events.on("market.snapshot.ingested", (p) => runDaily(ctx, p.date));
    ctx.events.on("post.ingested", (p) => { ctx.log.info(`post.ingested ${p.postIds.length} 条，等日批统一计算`); });
    ctx.events.on("recalc.requested", (p) => runRecalc(ctx, p));
    ctx.router?.post?.("/run", { preHandler: ctx.requirePermission("m3-engine:run") }, async (req) => {
      await runDaily(ctx, (req.body as { date?: string } | undefined)?.date);
      return { ok: true };
    });
  },
});
