// M3 配置键（manifest.config 声明，底座合并进配置中心；env CONFIG_* > system_config > 默认值）。
// 业务系数 a、b：score_params（version/effectiveFrom）；KOL 等级权重：kol_tiers（version/effectiveFrom）。
export const MODULE_NAME = "m3-engine";
export const CONFIG = [
  { key: "m3-engine.dailyCron", default: "0 0 * * *", description: "日批 cron（按 time.dayCutTimezone）" },
  { key: "m3-engine.batchLagDays", default: 1, description: "日批算 今天-N 天" },
  { key: "m3-engine.coreExposureTags", default: ["exchange_core", "top_vc", "whale", "top_kol"], description: "核心人物标签" },
  { key: "m3-engine.defaultTierWeight", default: 1, description: "人物池内未分级人物的权重" },
  { key: "m3-engine.multiProjectFullScore", default: true, description: "一帖多项目：true 每个项目记全分；false 平分" },
  { key: "m3-engine.recalcMaxDays", default: 400, description: "单次重算最多天数" },
] as const;
export type ConfigKey = (typeof CONFIG)[number]["key"];
export const DEFAULTS = Object.fromEntries(CONFIG.map((c) => [c.key, c.default])) as Record<ConfigKey, any>;
// 底座键（time.dayCutTimezone、posts.refetchDays）直接用 ctx.config.get 读，默认值在 @app/shared
