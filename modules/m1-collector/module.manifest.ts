// M1 数据采集：X 推文（人物池）、发帖后 N 天回抓指标、交易所现货 24h 美元成交额、CoinGecko 美元币价。不抓上币公告（V2）。
import { defineModule } from "@app/core";
import { registerRoutes, PERMS } from "./src/routes.js";
import { collectMarket, collectPosts, refetchMetrics } from "./src/collector.js";
import { CONFIG_SPEC, MODULE_NAME, key } from "./src/config.js";
import { flushOutbox } from "./src/state.js";

export default defineModule({
  apiVersion: 1,
  name: MODULE_NAME,
  version: "0.2.0",
  displayName: "M1 数据采集",
  requires: { core: "^1.1.0" },
  tables: {
    reads: ["people", "platforms", "projects", "exchanges", "posts"],
    writes: ["posts", "volume_snapshots", "price_snapshots"],
    owns: ["m_m1_collector_cursors", "m_m1_collector_runs", "m_m1_collector_locks", "m_m1_collector_outbox", "m_m1_collector_market_assets", "m_m1_collector_source_rates"],
  },
  apis: [
    { method: "GET", path: "/status", permission: PERMS.run, description: "抓取游标、来源质量与运行记录" },
    { method: "GET", path: "/sources", permission: PERMS.run, description: "数据源配置状态与私有系统占位" },
    { method: "GET", path: "/asset-mappings", permission: PERMS.run, description: "交易所资产身份映射" },
    { method: "PUT", path: "/asset-mappings", permission: PERMS.run, description: "维护明确的项目/交易所资产映射" },
    { method: "DELETE", path: "/asset-mappings/:projectId/:exchangeId", permission: PERMS.run, description: "删除资产映射" },
    { method: "POST", path: "/run/posts", permission: PERMS.run, description: "手动抓新帖" },
    { method: "POST", path: "/run/refetch", permission: PERMS.run, description: "手动回抓指标" },
    { method: "POST", path: "/run/market", permission: PERMS.run, description: "手动拉行情 {date?}" },
  ],
  subscribes: [],
  emits: ["post.ingested", "market.snapshot.ingested", "recalc.requested"],
  permissions: [{ key: PERMS.run, description: "手动触发采集", roles: ["admin"] }],
  config: CONFIG_SPEC,
  adminMenu: [{ path: "/sources", title: "数据源管理", component: "web/SourcesPage.tsx", permission: PERMS.run }],
  jobs: [
    { name: "collectPosts", cronKey: key("collectPostsCron"), run: async (ctx) => { await collectPosts(ctx); } },
    { name: "refetchMetrics", cronKey: key("refetchMetricsCron"), run: async (ctx) => { await refetchMetrics(ctx); } },
    { name: "collectMarket", cronKey: key("collectMarketCron"), run: async (ctx, data) => { await collectMarket(ctx, (data as any)?.date); } },
    { name: "dispatchOutbox", cronKey: key("dispatchOutboxCron"), run: async (ctx) => { await flushOutbox(ctx); } },
  ],
  register: async (ctx) => { registerRoutes(ctx); },
});
