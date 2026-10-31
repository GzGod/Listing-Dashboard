// 配置中心的全部键和默认值（老板要求：可能会变的东西一律做成变量，代码里不许写死）。
// 读取优先级：环境变量 CONFIG_<KEY 大写、点和短横线换成下划线> > system_config 表 > 这里的默认值。
// 例：CONFIG_RANKING_DEFAULT_WINDOW=30 覆盖 "ranking.defaultWindow"。环境变量值按 JSON 解析，解析失败按字符串。
export const CONFIG_DEFAULTS = {
  // ---- 业务口径（打分系数 a、b 在 score_params（带版本）；KOL 权重在 kol_tiers）----
  "posts.refetchDays": 7,                       // 发帖后回抓天数，之后固定
  "ranking.windows": [1, 7, 30] as number[],    // 可选时间窗（天）
  "ranking.defaultWindow": 7,                   // 默认时间窗
  "time.dayCutTimezone": "UTC",                 // 切日时区（IANA 时区名，如 "UTC"、"Asia/Shanghai"）
  "ranking.defaultDateOffsetDays": -1,          // 默认排名日期 = 今天(切日时区) + 偏移，-1 = 昨天
  "volume.market": "spot",                      // 交易量口径：现货（合约 V2）
  "volume.currency": "USD",
  "pagination.defaultPageSize": 20,
  "pagination.maxPageSize": 100,
  // ---- 队列 / 事件 ----
  "queue.attempts": 3,                          // 失败重试次数（含首次）
  "queue.backoffType": "exponential" as "exponential" | "fixed",
  "queue.backoffDelayMs": 1000,
  "queue.deadLetterQueue": "dead-letter",       // 死信队列名
  "queue.concurrency": 5,
  "queue.keepCompleted": 1000,
  "queue.keepFailed": 1000,
  // ---- 模块迁移 ----
  "modules.migrationWaitTimeoutMs": 120000,     // worker 等 server 跑完模块迁移的最长时间
  "modules.migrationPollMs": 500,               // worker 轮询迁移完成的间隔
  // ---- 外部服务模块 ----
  "external.timeoutMs": 10000,                  // 代理请求超时
  "external.healthIntervalMs": 15000,           // 健康检查间隔
  "external.healthTimeoutMs": 3000,
  // ---- 账号 ----
  "auth.jwtExpires": "12h",
  // ---- 定时任务 cron（按 time.dayCutTimezone）。键：jobs.<模块名>.<任务名>.cron，未配置时用 manifest 里的 cron ----
} as const;
export type ConfigKey = keyof typeof CONFIG_DEFAULTS;
export type ConfigValue<K extends ConfigKey> = (typeof CONFIG_DEFAULTS)[K] extends number ? number : (typeof CONFIG_DEFAULTS)[K] extends string ? string : (typeof CONFIG_DEFAULTS)[K];
export const configEnvName = (key: string) => "CONFIG_" + key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[.-]/g, "_").toUpperCase();
