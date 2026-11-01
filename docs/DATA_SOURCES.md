# 数据源与采集口径

对应 PRD v0.3 的 6.6、9、9.5 节。老 Lumina 与龙哥研究系统按当前决定先做占位，不请求虚构接口，不生成假的研究评级。

| 数据 | 当前来源 | 接入与缺失规则 |
| --- | --- | --- |
| KOL 帖子、浏览与收藏 | X API v2；支持显式 mock | 默认 disabled。只采启用的 X 人物池，分页断点持久化；未返回指标存 NULL，0 保留为 0 |
| 历史声量池 | 老 Lumina 占位 | 后台标记待接入，等待格式与样本 |
| 现货成交额 | Binance / OKX / Bybit 公开接口 | 完整日 K 线中的计价币成交额，不取合约，不把当前 24h ticker 写到历史日期 |
| 美元币价 | CoinGecko ID 对应历史币价 | 不按 ticker 推断币价；缺 ID 或接口无数据时为 NULL |
| 基本面、评级、赛道、用户量与收入 | 后台手动录入；龙哥系统占位 | 保留评级日期与运营数据来源；不自动产出评级 |
| 上币节点 | 后台手动录入 | 日期、交易所、阶段、交易对和公告链接；公告自动采集仍在 V2 |

## 管理入口

管理员进入 **后台 → 数据源管理**（`/admin/m/m1-collector/sources`），可查看来源状态、运行记录、缺少 CoinGecko ID 的项目、分页未完成账号和待同步事件，切换采集模式、手动运行采集、维护交易所资产映射。

X 默认未接入；行情默认使用公开接口。`pnpm db:seed` 会清空并生成演示数据，同时显式设置 X/行情为 mock，页面显示演示提示。生产数据请在独立数据库录入，使用实际 CoinGecko ID，并将行情切换为 live、X 切换为 xapi。切换来源不会自动清理已有演示快照。

交易所资产优先使用明确的 `(projectId, exchangeId, baseSymbol)` 映射；没有映射时仅允许唯一 ticker。多个项目同名时，未确认归属的项目不获取该 ticker 行情。同一个交易所资产不可同时绑定两个项目。保存映射必须填写确认依据并记审计日志，下一次采集生效；修复历史需指定日期重新采集。

## 日期、单位与价格

- 默认 UTC 0 点切日，自动行情采集默认日期为昨天；拒绝当天和未来日期。成交额以该完整日 `[00:00, 次日00:00)` 归档。
- UTC 用交易所日线：Binance `1d`、OKX `1Dutc`、Bybit `D`。其他已配置时区按实际日界累计小时线，半小时/四十五分钟偏移用分钟线；夏令时按该当地日实际长度取数。
- Binance 使用 K 线 quote asset volume（索引 7）；OKX 使用 `volCcyQuote`（索引 7）；Bybit 使用 turnover（索引 6）。OKX **现货 ticker 的 volCcy24h 本来就是计价币单位**，不能再乘最后价格。
- USD、USDT、USDC 按配置以 1:1 美元归一。这是明确的稳定币等价假设，不是实时汇率换算；其他计价币不能直接加入该列表。
- CoinGecko 较早 UTC 日末价格查询次日 UTC 00:00 的 history 值。最近完整日及非 UTC 日界使用结束时刻之前一小时内的最近历史采样点，避免 history 尚未归档；不声称其为逐笔收盘成交价。公开 API 的历史权限和保留时间仍受供应商限制。
- NaN、负数、非完整 K 线、业务错误和 HTTP 错误不转为 0。没有该区间的交易对历史不写新快照；应有数据但失败或身份未确认时写 NULL。同一资产和口径已有验证值时，重抓失败保留历史值和原抓取时间；变更资产、计价币口径或时区后不复用旧值。成交额快照保留来源身份与抓取时间，演示来源标记 mock。
- 任一已采集交易所明细为 NULL，当日项目总成交额为 NULL，不参与成交额排名。任一已确认帖子缺少计分所需指标，当日声量不参与排名；系数为 0 的指标可缺失。原帖仍可查看，指标显示「暂无数据」。

## 调度、恢复与预算

HTTP 请求有超时、有限重试、Retry-After / X rate-limit-reset 冷却与每来源限速。HTTP 429 和 5xx 可重试，业务 4xx 不重复请求。每个实际 X 请求（含重试）都原子计入每日预算；不把失败调用漏计。单个账号/币种失败会保留其他已完成数据和错误明细。

每人一次任务最多读取配置页数。未到末页时保存分页 token 与本轮最高 ID，末页结束才更新增量 since_id；失效的分页 token 会保留原增量起点并在下次重新分页。账号 ID 缓存在模块私有表，避免人物池每轮重复查用户。回抓只查 X 帖子，窗口外冻结；缺失项不覆盖已获取指标，冻结值不改写。

手动和定时任务用数据库租约互斥。采集事件先写持久 outbox，发出后再按修订号确认；每分钟恢复未投递事件，采用至少一次投递，下游幂等。重复采集会同步新值并重算，避免首次日批完成后数据更新未传到前台。成功的历史快照和身份映射不因 worker 重启丢失。

## 配置

优先级：非空 `CONFIG_*` 环境变量 > 配置中心数据库 > 默认值；`.env.example` 中未填写的空值不会覆盖默认值。密钥不写入配置中心或前端。

```dotenv
CONFIG_M1_COLLECTOR_X_SOURCE=xapi
X_BEARER_TOKEN=your-token
CONFIG_M1_COLLECTOR_MARKET_SOURCE=live
COINGECKO_API_KEY=your-key
# Pro 用户需同时改地址与密钥类型
CONFIG_M1_COLLECTOR_COINGECKO_API_KEY_TYPE=pro
CONFIG_M1_COLLECTOR_COINGECKO_BASE_URL=https://pro-api.coingecko.com/api/v3
CONFIG_M1_COLLECTOR_EXCHANGES='["Binance","OKX","Bybit"]'
CONFIG_M1_COLLECTOR_USD_QUOTES='["USD","USDT","USDC"]'
```

模块私有密钥也支持 `MOD_M1_COLLECTOR_X_BEARER_TOKEN` / `MOD_M1_COLLECTOR_COINGECKO_API_KEY`。Docker Compose 已转发常用密钥及来源设置。

全部采集参数在 `m1-collector.*` 配置中声明，包括分页量、每日预算、限速、HTTP 重试、CoinGecko 分批、历史日偏移、并发、租约、事件批量和定时表达式。保存配置后各进程可能有约 30 秒缓存；调整定时表达式或切日时区后重启 worker。

## 迁移与验证

```bash
pnpm db:generate
pnpm db:migrate                 # posts.views/bookmarks 改为可空，保留已有值
# 重启 server 执行 M1 私有表迁移，worker 等待迁移完成
pnpm test:sources
TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/source_tests pnpm test:sources:integration
pnpm check && pnpm typecheck && pnpm lint
pnpm --filter @app/web build
```

集成测试在随机独立 schema 中建表并清理，覆盖真实 PostgreSQL 迁移、并发预算、租约、事件失败恢复、分页断点、平台隔离、历史冻结、行情缺失和排名恢复。HTTP 测试替换外部响应，不需要真实密钥。真实 X 凭据及私人系统数据尚未提供，无法声称这些接入已完成线上验证。

参考接口：[Binance Klines](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data)、[OKX Market Data](https://www.okx.com/docs-v5/en/#rest-api-market-data)、[Bybit Kline](https://bybit-exchange.github.io/docs/v5/market/kline)、[CoinGecko History](https://docs.coingecko.com/reference/coins-id-history)、[X User Posts](https://docs.x.com/x-api/posts/user-posts-timeline/introduction)。
