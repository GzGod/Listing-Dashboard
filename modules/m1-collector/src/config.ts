// M1 所有可变参数，通过 manifest.config 声明进底座配置中心（键 m1-collector.<key>）。
// 优先级：env CONFIG_M1_COLLECTOR_<KEY> > system_config 表 > 这里的默认值。密钥走 ctx.config.env（MOD_M1_COLLECTOR_<KEY>）。
import type { ModuleContext } from "@app/core";

export const MODULE_NAME = "m1-collector";
export const PLATFORM_X = "X";
export const OWN = { cursors: "cursors", runs: "runs" } as const;

export const DEFAULTS = {
  xSource: "mock" as string,                       // mock | xapi
  xApiBaseUrl: "https://api.twitter.com/2",
  xMaxPostsPerPerson: 20,                  // 每人每次最多抓几条
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
  ingestBatchSize: 50,                     // post.ingested 每批 postId 数
  collectPostsCron: "0 */6 * * *",         // 抓新帖（cron 按底座 time.dayCutTimezone）
  refetchMetricsCron: "30 0 * * *",        // 回抓指标
  collectMarketCron: "10 0 * * *",         // 拉当日成交额 + 币价
} as const;
const DESC: Partial<Record<keyof typeof DEFAULTS, string>> = {
  xSource: "X 抓取适配器 mock | xapi", xDailyCap: "每天 X 接口调用上限", xRateLimitPerMin: "X 每分钟请求上限",
  marketSource: "行情来源 live | mock", exchanges: "统计成交额的交易所（exchanges.name）", usdQuotes: "算作美元的计价币",
  httpTimeoutMs: "外部请求超时", httpRetries: "外部请求重试次数", collectPostsCron: "抓新帖 cron", refetchMetricsCron: "回抓指标 cron", collectMarketCron: "拉行情 cron",
};
export const key = (k: keyof typeof DEFAULTS) => `${MODULE_NAME}.${k}`;
/** manifest.config 声明 */
export const CONFIG_SPEC = Object.entries(DEFAULTS).map(([k, d]) => ({ key: key(k as keyof typeof DEFAULTS), default: d, description: DESC[k as keyof typeof DEFAULTS] }));
export type M1Config = { -readonly [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] extends readonly string[] ? string[] : (typeof DEFAULTS)[K] } & { refetchDays: number; tz: string };


export async function loadConfig(ctx: ModuleContext): Promise<M1Config> {
  const out: any = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = await ctx.config.get(key(k as keyof typeof DEFAULTS), d);
  out.refetchDays = await ctx.config.get("posts.refetchDays"); // 全局口径（默认 7）
  out.tz = await ctx.config.get("time.dayCutTimezone");         // 底座切日时区（默认 UTC），所有日期按它切
  return out as M1Config;
}
