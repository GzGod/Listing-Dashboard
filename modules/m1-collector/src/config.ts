// M1 所有可变参数，通过 manifest.config 声明进底座配置中心（键 m1-collector.<key>）。
// 优先级：env CONFIG_M1_COLLECTOR_<KEY> > system_config 表 > 这里的默认值。密钥走 ctx.config.env（MOD_M1_COLLECTOR_<KEY>）。
import type { ModuleContext } from "@app/core";

export const MODULE_NAME = "m1-collector";
export const PLATFORM_X = "X";
export const OWN = { cursors: "cursors", runs: "runs", locks: "locks", outbox: "outbox", assets: "market_assets", rates: "source_rates" } as const;

export const DEFAULTS = {
  xSource: "disabled" as string,                   // disabled | mock | xapi；无密钥时不伪造声量
  xApiBaseUrl: "https://api.twitter.com/2",
  xMaxPostsPerPerson: 20,                  // 每页条数（官方最低 5，最高 100）
  xMaxPagesPerPerson: 10,                  // 分页上限，未完成的分页会保存断点
  xDailyCap: 2000,                         // 每天最多调用 X 接口次数（含回抓）
  xRateLimitPerMin: 60,                    // 每分钟请求上限
  xLookupBatch: 100,                       // tweet lookup 每批 id 数（X v2 上限 100）
  marketSource: "live" as string,                   // live | mock
  exchanges: ["Binance", "OKX", "Bybit"] as string[], // 统计成交额的交易所（需和 exchanges.name 对上）
  usdQuotes: ["USD", "USDT", "USDC"] as string[],     // 算作美元的计价币
  coingeckoBaseUrl: "https://api.coingecko.com/api/v3",
  binanceBaseUrl: "https://api.binance.com",
  okxBaseUrl: "https://www.okx.com",
  bybitBaseUrl: "https://api.bybit.com",
  httpTimeoutMs: 10000,
  httpRetries: 3,
  httpRetryDelayMs: 1000,
  httpMaxRetryDelayMs: 60000,
  coingeckoApiKeyType: "demo" as string,    // demo | pro
  coingeckoBatchSize: 100,
  marketDateOffsetDays: -1,                // 自动采集最近完整日，不能把实时值冒充历史
  marketConcurrency: 3,
  runLockTtlMs: 180000,
  outboxBatchSize: 100,
  outboxRetentionDays: 7,
  marketRateLimitPerMin: 120,
  coingeckoRateLimitPerMin: 30,
  ingestBatchSize: 50,                     // post.ingested 每批 postId 数
  collectPostsCron: "0 */6 * * *",         // 抓新帖（cron 按底座 time.dayCutTimezone）
  refetchMetricsCron: "30 0 * * *",        // 回抓指标
  collectMarketCron: "10 1 * * *",         // 最近完整日成交额 + 币价，预留供应商归档时间
  dispatchOutboxCron: "* * * * *",         // 恢复尚未投递的采集事件
} as const;
const DESC: Partial<Record<keyof typeof DEFAULTS, string>> = {
  xSource: "X 抓取适配器 disabled | mock | xapi", xDailyCap: "每天 X 接口调用上限（含每次重试）", xRateLimitPerMin: "X 每分钟请求上限",
  marketSource: "行情来源 live | mock", exchanges: "统计成交额的交易所（exchanges.name）", usdQuotes: "算作美元的计价币",
  httpTimeoutMs: "外部请求超时", httpRetries: "外部请求重试次数", collectPostsCron: "抓新帖 cron", refetchMetricsCron: "回抓指标 cron", collectMarketCron: "拉行情 cron",
};
export const key = (k: keyof typeof DEFAULTS) => `${MODULE_NAME}.${k}`;
/** manifest.config 声明 */
export const CONFIG_SPEC = Object.entries(DEFAULTS).map(([k, d]) => ({ key: key(k as keyof typeof DEFAULTS), default: d, description: DESC[k as keyof typeof DEFAULTS], public: k === "xSource" || k === "marketSource" }));
export type M1Config = { -readonly [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] extends readonly string[] ? string[] : (typeof DEFAULTS)[K] extends string ? string : number } & { refetchDays: number; tz: string };


export async function loadConfig(ctx: ModuleContext): Promise<M1Config> {
  const out: any = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = await ctx.config.get(key(k as keyof typeof DEFAULTS), d);
  out.refetchDays = await ctx.config.get("posts.refetchDays"); // 全局口径（默认 7）
  out.tz = await ctx.config.get("time.dayCutTimezone");         // 底座切日时区（默认 UTC），所有日期按它切
  return validateConfig(out as M1Config);
}

export function validateConfig(c: M1Config): M1Config {
  if (!["disabled", "mock", "xapi"].includes(c.xSource)) throw new Error("xSource 需为 disabled / mock / xapi");
  if (!["live", "mock"].includes(c.marketSource)) throw new Error("marketSource 需为 live / mock");
  if (!["demo", "pro"].includes(c.coingeckoApiKeyType)) throw new Error("coingeckoApiKeyType 需为 demo / pro");
  for (const k of ["xMaxPostsPerPerson", "xMaxPagesPerPerson", "xRateLimitPerMin", "xLookupBatch", "httpTimeoutMs", "httpRetries", "ingestBatchSize", "coingeckoBatchSize", "marketConcurrency", "runLockTtlMs", "refetchDays", "outboxBatchSize", "outboxRetentionDays", "marketRateLimitPerMin", "coingeckoRateLimitPerMin"] as const)
    if (!Number.isSafeInteger(c[k]) || c[k] <= 0) throw new Error(`${k} 需为正整数`);
  for (const k of ["xDailyCap", "httpRetryDelayMs", "httpMaxRetryDelayMs"] as const)
    if (!Number.isSafeInteger(c[k]) || c[k] < 0) throw new Error(`${k} 需为非负整数`);
  if (c.xLookupBatch > 100 || c.xMaxPostsPerPerson > 100) throw new Error("X 每批最多 100 条");
  if (!Number.isSafeInteger(c.marketDateOffsetDays) || c.marketDateOffsetDays >= 0) throw new Error("marketDateOffsetDays 需为负整数（完整历史日）");
  for (const k of ["exchanges", "usdQuotes"] as const)
    if (!Array.isArray(c[k]) || !c[k].length || !c[k].every((v) => typeof v === "string" && v.trim())) throw new Error(`${k} 需为非空字符串数组`);
  c.exchanges = [...new Set(c.exchanges.map((v) => v.trim()))];
  c.usdQuotes = [...new Set(c.usdQuotes.map((v) => v.trim().toUpperCase()))];
  if (c.usdQuotes.some((v) => !["USD", "USDT", "USDC"].includes(v))) throw new Error("usdQuotes 仅支持 USD / USDT / USDC，其他币种不能直接视为美元");
  for (const k of ["xApiBaseUrl", "coingeckoBaseUrl", "binanceBaseUrl", "okxBaseUrl", "bybitBaseUrl"] as const) {
    const u = new URL(c[k]);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(`${k} 需为不含凭据、查询或片段的 HTTP(S) 地址`);
    c[k] = c[k].replace(/\/+$/, "");
  }
  new Intl.DateTimeFormat("en-CA", { timeZone: c.tz });
  return c;
}
