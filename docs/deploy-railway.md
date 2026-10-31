# 部署到 Railway

一个仓库 → Railway 项目里 4 个服务：**Postgres**（插件）、**Redis**（插件）、**server**、**web**。

## server（Fastify + worker）
- Dockerfile：`deploy/railway/server.Dockerfile`
- Config as code：Settings → Config-as-code 填 `deploy/railway/server.railway.json`（含健康检查 `/api/_core/health`）
- Root Directory：留空（仓库根，monorepo 需要整个工作区）
- Watch Paths（可选）：`apps/server/**` `apps/worker/**` `packages/**` `modules/**` `deploy/railway/**` `pnpm-lock.yaml`
- 启动流程（`deploy/railway/start-server.sh`）：`prisma migrate deploy` → 库里没有用户时才跑种子（种子会清空核心表，所以只在空库跑）→ 延迟启动 worker → server 监听 `0.0.0.0:$PORT`
- 给 web 用的私网地址：Settings → Networking 不需要公网域名

| 变量 | 值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Postgres 插件 |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Redis 插件 |
| `JWT_SECRET` | 随机长字符串 | 必填，别用默认值 |
| `MODULE_TOKEN` | 随机长字符串 | 外部模块回调用 |
| `SEED_ADMIN_PASSWORD` | 自定 | 种子账号 admin@local / editor@local / viewer@local 的密码；不填就是开发默认密码，对外部署必须填 |
| `DISABLED_MODULES` | `py-example` | 逗号分隔 |
| `CONFIG_M1_COLLECTOR_X_SOURCE` | `mock` | X 数据源 |
| `CONFIG_M1_COLLECTOR_MARKET_SOURCE` | `mock` | 行情数据源 |
| `CONFIG_M4_ADMIN_M2_MOCK` | `off` | |
| `SEED_ON_EMPTY` | `1`（默认） | `0` 关掉自动种子 |
| `RUN_WORKER` | `1`（默认） | `0` 时不在同容器起 worker（可另建 worker 服务，启动命令 `node --import tsx apps/worker/src/main.ts`） |
| `WORKER_DELAY_S` | `20`（默认） | worker 等 server 跑完模块迁移 |
| `LOG_LEVEL` | `info` | 可选 |
| `PORT` | Railway 自动注入 | |

## web（Next.js）
- Dockerfile：`deploy/railway/web.Dockerfile`
- Config as code：`deploy/railway/web.railway.json`
- Root Directory：留空；Watch Paths（可选）：`apps/web/**` `packages/**` `modules/**` `deploy/railway/**` `pnpm-lock.yaml`
- Networking：生成公网域名（这是给人打开的地址）。浏览器只访问 web，`/api/*` 由 Next 转发给 server。

| 变量 | 值 | 说明 |
|---|---|---|
| `API_URL` | `http://${{server.RAILWAY_PRIVATE_DOMAIN}}:${{server.PORT}}` | server 私网地址。**构建时也要用**（Next 把 rewrites 写进构建产物），Dockerfile 已声明 `ARG API_URL`，Railway 会自动把同名变量传进构建 |
| `PORT` | Railway 自动注入 | |

> server 需显式设 `PORT=4000`（或任意值）才能被 `${{server.PORT}}` 引用。改 `API_URL` 后要重新部署 web（重新构建）。
