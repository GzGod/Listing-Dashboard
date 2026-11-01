// M2 可变参数：manifest.config 声明，键 m2-matcher.<key>（env CONFIG_M2_MATCHER_<KEY> > system_config > 默认值）
import type { ModuleContext } from "@app/core";
export const MODULE_NAME = "m2-matcher";
export const DEFAULTS = {
  autoConfirmThreshold: 0.85,     // 置信度 >= 阈值自动确认，否则进确认队列
  scoreContract: 1.0,             // 合约地址命中
  scoreCashtag: 0.9,              // $TICKER 命中（唯一）
  scoreName: 0.85,                // 项目全名/名称别名命中
  scoreBareTicker: 0.9,           // PRD：唯一大写 ticker 命中可确认，同名才排队
  minTickerLength: 2,             // 太短的 ticker 不做裸词匹配
  reviewPageSize: 50,
} as const;
export const key = (k: keyof typeof DEFAULTS) => `${MODULE_NAME}.${k}`;
export const CONFIG_SPEC = Object.entries(DEFAULTS).map(([k, d]) => ({ key: key(k as keyof typeof DEFAULTS), default: d }));
export type M2Config = { -readonly [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] } & { refetchDays: number; tz: string };
export async function loadConfig(ctx: ModuleContext): Promise<M2Config> {
  const out: any = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = await ctx.config.get(key(k as keyof typeof DEFAULTS), d);
  out.refetchDays = await ctx.config.get("posts.refetchDays");
  out.tz = await ctx.config.get("time.dayCutTimezone"); // 底座切日时区（北京时间 = "Asia/Shanghai"）
  return out;
}
