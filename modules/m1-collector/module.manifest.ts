// M1 数据采集：X 推文（人物池）、发帖后 N 天回抓指标、交易所现货 24h 美元成交额、CoinGecko 美元币价。不抓上币公告（V2）。
import { defineModule } from "@app/core";
import { registerRoutes, PERMS } from "./src/routes.js";
import { collectMarket, collectPosts, refetchMetrics } from "./src/collector.js";
import { CONFIG_SPEC, MODULE_NAME, key } from "./src/config.js";

export default defineModule({
  apiVersion: 1,
  name: MODULE_NAME,
  version: "0.1.0",
  displayName: "M1 数据采集",
  requires: { core: "^1.1.0" },
  tables: {
    reads: ["people", "platforms", "projects", "exchanges", "posts"],
    writes: ["posts", "volume_snapshots", "price_snapshots"],
    owns: ["m_m1_collector_cursors", "m_m1_collector_runs"],
  },
  apis: [
    { method: "GET", path: "/status", description: "抓取游标与运行记录" },
    { method: "POST", path: "/run/posts", permission: PERMS.run, description: "手动抓新帖" },
    { method: "POST", path: "/run/refetch", permission: PERMS.run, description: "手动回抓指标" },
    { method: "POST", path: "/run/market", permission: PERMS.run, description: "手动拉行情 {date?}" },
  ],
  subscribes: [],
  emits: ["post.ingested", "market.snapshot.ingested"],
  permissions: [{ key: PERMS.run, description: "手动触发采集", roles: ["admin"] }],
  config: CONFIG_SPEC,
  jobs: [
    { name: "collectPosts", cronKey: key("collectPostsCron"), run: async (ctx) => { await collectPosts(ctx); } },
    { name: "refetchMetrics", cronKey: key("refetchMetricsCron"), run: async (ctx) => { await refetchMetrics(ctx); } },
    { name: "collectMarket", cronKey: key("collectMarketCron"), run: async (ctx, data) => { await collectMarket(ctx, (data as any)?.date); } },
  ],
  register: async (ctx) => { registerRoutes(ctx); },
});
