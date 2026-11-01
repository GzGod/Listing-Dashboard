# Crypto 上币看板 · 底座 M0

可插拔模块底座：Turborepo + TypeScript，Fastify 后端（模块宿主），Next.js 前后台外壳，PostgreSQL/Prisma，Redis/BullMQ（独立 worker、重试、死信队列、cron），配置中心，JWT 登录、权限、审计日志。

```bash
docker compose up --build        # http://localhost:3000  admin@local / admin123（另有 editor@local、viewer@local）
```

不用 Docker 时：准备好 Postgres、Redis，复制 `.env.example` 为 `.env` 并 export，然后
`pnpm install && pnpm db:generate && pnpm db:migrate && pnpm db:seed`，再分别运行 `pnpm run server`、`pnpm run worker`、`pnpm --filter @app/web dev`。

目录：`packages/core`（ModuleHost、事件总线、鉴权、审计、配置中心、写入归属）、`packages/shared`（共享契约）、`packages/db`（Prisma 核心表、迁移、种子）、`packages/ui`（基础组件）、`apps/server`、`apps/worker`、`apps/web`、`modules/example`（TS 示例）、`modules/py-example`（Python 外部服务示例）、`templates/blank-module`。

接入说明见 [docs/MODULE_GUIDE.md](docs/MODULE_GUIDE.md)。

## MVP 运行方式（上币看板）

```bash
pnpm i
cp .env.example .env            # 填好 DATABASE_URL / REDIS_URL / JWT_SECRET 等
set -a; . ./.env; set +a        # Prisma 不读根目录 .env，需先导出
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm run server                 # 注意要用 `pnpm run`，`pnpm server` 是 pnpm 自带命令
pnpm run worker
pnpm --filter @app/web build && (cd apps/web && npx next start -p 3000)
```

> ⚠️ 种子账号 `admin@local` / `editor@local` / `viewer@local` 的密码是 `admin123`，只用于本地开发。任何对外部署前务必停用或改密码。

### 模块

| 模块 | 说明 |
| --- | --- |
| `m1-collector` | X 帖子采集、交易所成交额与 CoinGecko 币价（mock / 实时） |
| `m2-matcher` | 帖子与项目别名匹配，按帖审核队列 |
| `m3-engine` (0.4.1) | 声量计分、日批、回算（按 `time.dayCutTimezone` 切日，默认 UTC） |
| `m4-admin` | 后台：项目、人物池、权重、调分、别名、确认队列、赛道 |
| `m5-rankings` | 前台细分赛道声量排行榜（1/7/30 天） |
| `m6-project` | 前台项目详情页与联动图（依赖 `echarts`） |

其他目录：`docs/prd/PRD-v0.3.tsx`（PRD），`tests/integration/it-m4.ts`（M4 集成测试），`scripts/demo/`（演示数据和冒烟脚本，登录信息通过命令行参数传入）。

## 数据源优化

管理员在「后台 → 数据源管理」查看来源状态、分页断点、缺失项目、错误记录，并维护交易所资产映射。行情按完整历史日采集，缺失指标保留 NULL 并退出对应排名；采集事件支持失败后恢复。X 默认未接入，老 Lumina 和龙哥研究系统先占位，基本面与上币节点按 PRD MVP 手动维护。

`db:seed` 显式使用演示来源并显示提示。真实接入的密钥、日期与单位口径、迁移和测试说明见 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)。
