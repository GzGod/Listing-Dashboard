# 模块接入指南（MODULE_GUIDE）

> 底座 M0 · 底座版本 `1.1.0` · manifest 规范 `apiVersion: 1`
> 同事照这份文档写模块，交过来后不改底座代码就能合并。

## 0. 先看这几条（硬规则）

1. **后端是 Fastify，不是 NestJS。** 不要写 `@Module` / `@Controller` / `@Injectable` 这类 Nest 写法。路由用 `ctx.router.get/post(...)`（Fastify 实例，已带 `/api/<模块名>` 前缀）。
2. **一个模块一个目录**：`modules/<模块名>/`，加目录 = 安装，删目录（`pnpm module:uninstall`）= 卸载。
3. **模块之间不能直接 import 对方代码**，只能调对方公开的 HTTP 接口或发/收事件。CI 里的 dependency-cruiser 会拦。
4. **表的读写规则（见第 6 节）**：任何核心表都能读；只能写**归属于自己**的核心表/列；不能改核心表结构；不能碰别的模块的 `m_<别人>_*` 表。
5. **不许写死可变参数（magic number）**：天数、时间窗、超时、重试次数、cron、分页大小等一律从配置中心读（第 8 节）。
6. 审计日志只能用 `ctx.audit(...)` 写，任何对数据的人工修改都必须写一条。

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 仓库 | pnpm workspace + Turborepo，全 TypeScript |
| 后端 | **Fastify 5**（`packages/core` 的 ModuleHost 负责扫描/挂载模块） |
| 前端 | Next.js 15（前台外壳 + 后台外壳），基础组件在 `@app/ui` |
| 数据库 | PostgreSQL + Prisma（核心表），模块自有表用 SQL 迁移 |
| 队列 | Redis + BullMQ，独立 worker 进程；失败自动重试，用尽进死信队列 |
| 共享契约 | `@app/shared`：表类型、事件类型、接口类型、配置键默认值、假数据 |
| 部署 | `docker compose up --build` |

## 2. 目录与命名规范

```
modules/<name>/
  module.manifest.ts        # 代码内模块（TS）必需；外部服务模块用 module.manifest.json
  package.json              # name 用 @modules/<name>；依赖只能有 @app/core、@app/shared、@app/ui 和第三方包
  src/                      # 后端代码（路由、服务）
  web/                      # 前端页面组件（默认导出 React 组件，"use client"）
  migrations/001_xxx.sql    # 自有表迁移，按文件名顺序执行，执行过的不会重复执行
```

- 模块名 `name`：小写字母开头，只含小写字母、数字、短横线，例如 `m1-collector`。
- 接口路径：`/api/<name>/...`（底座自动加前缀）。
- **自有表前缀规则**：`m_` + 模块名（`-` 换成 `_`）+ `_`，后面接表名。例如 `m4-admin` → 前缀 `m_m4_admin_`，表 `m_m4_admin_drafts`；`m1-collector` → `m_m1_collector_raw_tweets`。代码里用 `ctx.db.t("drafts")` 拼，别手写。
- 权限 key：`<name>:<动作>`，例如 `m4-admin:write`。
- 版本 `version`：语义化版本（`1.2.0`）。不兼容改动升主版本。

### 2.0 ctx.redis（模块用 Redis）

- 底座给**每个模块各一条**底座管理的 ioredis 连接（不是所有模块共用一条；因为 ioredis 的 keyPrefix 是连接级的）：`ctx.redis`，懒连接、进程退出时底座负责关闭，地址来自核心 `REDIS_URL`，**所有 key 自动加前缀 `m:<模块名>:`**（ioredis keyPrefix），各模块写同名 key 也不会冲突。例：`await ctx.redis.incr("hits")` 实际写的是 `m:example:hits`。
- **模块不能自己 `import "ioredis"` / 读 `REDIS_URL` 建连接**，`pnpm check` 会报错；也没有 `MOD_<ID>_REDIS_URL` 这种覆盖。
- Redis 挂了：`ctx.redis` 的命令会很快 reject，只让调用它的接口/任务报错，不影响其他模块和底座；恢复后自动重连。请自己 try/catch 做降级。
- 注意：`keys`/`scan` 的返回值带完整前缀；BullMQ 队列请用 `ctx.events`，不要用 ctx.redis 自建队列。

### 2.1 模块的 tsconfig

仓库根有 `tsconfig.module.json`，模块目录里的 `tsconfig.json` 只需要：

```json
{ "extends": "../../tsconfig.module.json", "include": ["module.manifest.ts", "src/**/*", "web/**/*"] }
```

**前端代码（`web/`）用另一套基线 `tsconfig.module.web.json`**：和 Next.js 壳一致（`moduleResolution: Bundler`、`jsx: preserve`、DOM、`next-env.d.ts`），`next/link`、`next/navigation`、react、`@app/ui` 都从底座 `apps/web` 解析；web 里相对 import 不用写 `.js`。后端/共享代码（manifest、`src/`、`server/` 等）用 `tsconfig.module.json`（NodeNext，相对 import 要写 `.js`）。模块目录可放 `web/tsconfig.json`：`{ "extends": "../../../tsconfig.module.web.json", "include": ["**/*.ts", "**/*.tsx"] }`。

`pnpm typecheck` 用 `tsconfig.modules.json`（后端，除 web/）+ `tsconfig.modules.web.json`（web/）检查 `modules/*` 下**全部** TS/TSX。`pnpm check --dir` 和 `--module` **默认都做同样的两遍类型检查**（结论一致，错误行以「类型检查(后端)/(前端):」开头），加 `--no-typecheck` 只跑静态规则。回归用例：`modules/example/web/NextImportsFixture.tsx`、`pnpm test:check`。ESLint 已带 `eslint-plugin-react-hooks`（`rules-of-hooks` 报错、`exhaustive-deps` 警告），模块里写 `// eslint-disable-next-line react-hooks/exhaustive-deps` 不会再报"规则不存在"。

它统一了 ESM（NodeNext，import 写 `./x.js` 后缀）、严格模式和 React JSX。模板和 `modules/example` 已经这么配。

## 3. 快速开始

```bash
pnpm module:new m9-demo     # 从 templates/blank-module 复制一个空白模块
pnpm install                # 让新模块拿到 @app/* 依赖
pnpm db:generate            # 生成 Prisma Client 类型（pnpm typecheck 会自动先跑这一步）
pnpm typecheck              # 根目录 + modules/* 全部 TS/TSX（含 web/、server/）+ web 壳
pnpm check                  # 校验 manifest、表前缀、写入归属
# 重启 server + worker（docker compose restart server worker web；web 需要重新 build 才会打包新页面）
```

## 4. manifest 字段参考（`apiVersion: 1`）

```ts
import { defineModule } from "@app/core";
export default defineModule({
  apiVersion: 1,                         // 必填，固定 1
  name: "m9-demo",                       // 必填
  version: "1.0.0",                      // 必填，semver
  displayName: "演示",
  requires: { core: "^1.1.0" },          // 兼容的底座版本；不满足 → 该模块不加载，其他照常
  dependsOn: [],                         // 依赖的其他模块名；依赖不可用 → 本模块跳过
  tables: {
    reads: ["projects"],                 // 读哪些表（说明用途，任何核心表都允许读）
    writes: [],                          // 要写的核心表（只按整表声明），必须在写入归属表里归本模块
    owns: ["m_m9_demo_items"],           // 自有表，必须 m_<name>_ 前缀
  },
  apis: [{ method: "GET", path: "/items", permission: "m9-demo:read", description: "…" }], // 对外接口（文档 + 评审用）
  subscribes: ["post.ingested"],         // 订阅的事件（不声明就收不到）
  emits: ["recalc.requested"],           // 会发的事件
  permissions: [{ key: "m9-demo:write", roles: ["admin", "editor"] }],
  adminMenu:   [{ path: "/", title: "演示", component: "web/AdminPage.tsx", permission: "admin:access" }],
  // hidden: true = 能访问但不进菜单；"/:id" 这类动态路由自动 hidden
  frontRoutes: [{ path: "/", title: "演示", component: "web/FrontPage.tsx" },
                { path: "/:id", title: "详情", component: "web/Detail.tsx", hidden: true }],
  config: [{ key: "m9-demo.dailyCron", default: "5 0 * * *", description: "日任务 cron" },
           { key: "m9-demo.pageSize", default: 20, public: true }],     // 本模块配置键，必须 m9-demo. 开头；public 的前端可读
  jobs: [{ name: "daily", cronKey: "m9-demo.dailyCron", run: async (ctx, data) => {} }],
  migrations: "migrations",              // 默认就是 migrations
  register: async (ctx) => { /* 注册路由、ctx.events.on(...)、ctx.services.provide(...) */ },
  start: async (ctx) => {},              // 可选
  stop: async (ctx) => {},               // 可选
});
```

页面 URL：前台 `/m/<name><path>`，后台 `/admin/m/<name><path>`。`path` 支持动态段，例如 `{ path: "/:id", component: "web/Detail.tsx" }` → `/m/m6-project/123`；只想能访问、不进菜单的页面（详情页等）加 `hidden: true`；带 `:` 的路由自动视为 hidden。页面组件收到 `props.params`（如 `{ id: "123" }`）和 `props.searchParams`（URL 查询参数），类型 `ModulePageProps`（`@app/ui`）。示例见 `modules/example` 的 `/notes/:id`。菜单由底座根据 manifest 自动生成，按 `permission` 过滤。每个模块页面外面都包了 Error Boundary：页面报错只显示"该模块暂不可用"，外壳和其他模块不受影响。

## 5. `ctx`（模块拿到的底座能力）

| 能力 | 用法 |
|---|---|
| 路由 | `ctx.router.get("/items", { preHandler: ctx.requirePermission("m9-demo:read") }, async (req) => ...)`；`req.user` 是当前登录用户 |
| 数据库 | `ctx.db.core`：Prisma 客户端（已加作用域，见第 6 节）；`ctx.db.core.$queryRaw\`SELECT ... WHERE id = ${id}\`` 或 `ctx.db.core.$queryRaw(sql\`... IN (${join(ids)})\`)`（`sql`/`join`/`empty` 从 `@app/core` 导入，即 Prisma.sql 片段）：原生只读查询，参数自动绑定，只能是单条 SELECT/WITH（`--`、`/* */` 注释和单引号字符串里的分号不算多语句；末尾单独一个 `;` 允许；`SELECT 1; DELETE ...` 会被拒）；`ctx.db.query(sql, ...params)`：读写**自有表**（`$1` 参数绑定）；`ctx.db.t("items")` → `m_m9_demo_items`。**禁止** `$queryRawUnsafe`、`$executeRaw`、`$executeRawUnsafe`、`Prisma.raw`、直接 import `@app/db` / `@prisma/client`：scoped db 调用即报错，`pnpm check` 扫源码也会报。**`pg` 只许在测试文件里用**（`*.test.ts`、`*.spec.ts`、`test/`、`tests/`、`__tests__/`；根目录已装 `vitest`、`pg`、`@types/pg`，web 壳已装 `echarts`），运行时代码 import `pg` 会被 `pnpm check` 拒绝 |
| 审计 | `await ctx.audit({ action: "update", table: "projects", recordId: id, before, after, actorId: req.user?.id })` 一行写入 `audit_logs` |
| 事件 | `await ctx.events.emit("recalc.requested", {...})`；`ctx.events.on("post.ingested", async (payload, meta) => {...})`（在 worker 进程执行，抛错会重试） |
| 配置 | `await ctx.config.get("posts.refetchDays")`；`await ctx.config.scoreParams("2026-10-30")`；`ctx.config.env("API_KEY")` 读本模块私有环境变量 `MOD_<NAME>_API_KEY` |
| 日志 | `ctx.log.info/warn/error(msg, extra)`，统一 JSON 格式，自动带模块名 |
| 服务 | `ctx.services.provide(name, impl)` / `get(name)`（同进程内模块间公开 service，需要 dependsOn） |
| 错误 | `throw new AppError(400, "BAD_INPUT", "说明")`，底座统一返回 `{ error: { code, message, module, requestId } }` |

## 6. 表的读写规则与写入归属

- **读**：任何模块都可以读任何核心表（`ctx.db.core.xxx.findMany`）。
- **写**：`tables.writes` **只按整表声明，不做列级归属**（写 `"projects"`，不能写 `"projects.name"`）。只能写 manifest `tables.writes` 里声明、且在 `packages/core/src/ownership.ts` 里归属于本模块的核心表。`pnpm check` 会校验声明，运行时 `ctx.db.core` 会拦截越权写入，`ctx.db.query` 会拦截对核心表的 DDL 和越权 SQL 写入。
- **不能**改核心表结构（核心表改动要提 PR 改 `packages/db/prisma/schema.prisma`，评审后由底座生成迁移）。
- **不能**碰其他模块的 `m_<别人>_*` 表；要别人的数据就调对方接口或订阅事件。
- 卸载模块只删它自己的 `m_<name>_*` 表，绝不碰核心表。
- 原生 SQL：只允许模板字符串 `ctx.db.core.$queryRaw\`...\`` 做只读查询；`$queryRawUnsafe` / `$executeRaw*` 禁止。

**核心表写入归属（提议稿，待技术评审确认）**

| 核心表 | 唯一写入方 |
|---|---|
| `posts`、`volume_snapshots`、`price_snapshots` | m1-collector |
| `post_mentions` | m2-matcher |
| `buzz_snapshots`（整表：三个子项、raw_total、adjusted_total、params_version、tiers_version、track_id、track_rank）、`project_daily`（含 track_id、volume_track_rank，均可为 null） | m3-engine |
| `buzz_adjustments`（人工调分记录） | m4-admin |
| `projects`（含 `coingecko_id`、`track_id` 当前赛道）、`project_contracts`、`project_aliases`、`listing_events`、`tracks`、`people`、`person_tags`、`score_params`、`system_config`、`users`、`exchanges`、`platforms`、`kol_tiers` | m4-admin |
| `users` | 只有底座（M4 的 AD-07 页面调 `/api/_core/users`） |
| `audit_logs` | 只有底座（各模块通过 `ctx.audit` 写） |

**快照的约定（M3 必须遵守）**
- **缺数据的日子没有行**：某项目某天整天没数据，`buzz_snapshots` / `project_daily` / `price_snapshots` / `volume_snapshots` 里就不写这一行，**不要写 0 行**。前台据此显示"暂无数据"、不进排名。
- **行内单项缺失 = null，不是 0**：有行但某个度量没取到时（如 `project_daily.total_spot_volume_usd`、`price_usd`，`volume_snapshots.spot_volume_usd_24h`，`price_snapshots.price_usd`）写 null。
- **当日赛道**：`buzz_snapshots.track_id`、`project_daily.track_id` 存项目**当天**所属赛道，写快照时取 `projects.track_id`。m4-admin 只改 `projects.track_id`（当前赛道）。**回补/重算时**：该日已有快照就沿用快照里的 `track_id`，没有快照才用 `projects.track_id`。这样项目换赛道后历史排名不变。**项目还没有赛道**（`projects.track_id` 为 null）时，M3 照常写当天的 `buzz_snapshots` / `project_daily` 行，但 `track_id = null`，`track_rank` / `volume_track_rank` 也为 null（不参与任何赛道排名）。
- **赛道内排名**（m3-engine 写，PRD §10/§11）：`buzz_snapshots.track_rank` 按当日同 `track_id` 内的 `adjusted_total` 降序；`project_daily.volume_track_rank` 按当日同赛道的现货成交额降序。并列同名次、下一名跳号（1,1,3）。值为 null 的项目不参与排名、`rank` 为 null。收到 `recalc.requested`（包括 `manual_adjust`）重算受影响日期时，必须把那一天整个赛道的排名一起重算。
- **赛道不能删（外键 RESTRICT）**：`projects.track_id`、`buzz_snapshots.track_id`、`project_daily.track_id` 指向 `tracks` 的外键都是 `ON DELETE RESTRICT`。只要有任何项目或历史快照引用某赛道，删除就会失败（Prisma 错误码 P2003 / Postgres 外键错误），保证历史排名可追溯；没被引用的赛道可以删。M4 删除前应提示"该赛道已被使用"。
- **计划中（待 PRD/老板确认，本底座未实现）**：`tracks.disabled_at`（停用赛道而不删除）。确认前不要在模块里依赖这个字段。
- **只有人工调整、没有原始数据的日子**：`buzz_snapshots` 的 `raw_total` 和三个子项（`kol_post_count`、`core_exposure_count`、`heat_score`）可为 null，`adjusted_total` 必填。某天没有原始数据、但有一条未撤销的 `buzz_adjustments` 时，M3 写一行：原始列全 null，`adjusted_total = 调整值`；该调整被撤销后（且仍无原始数据），M3 重算时**删除这一行**（回到"缺数据的日子没有行"）。
- **ctx.db.query 的写入检查**：底座会解析 SQL 里的写目标表；`INSERT ... ON CONFLICT (...) DO UPDATE SET ...` / `DO NOTHING`、`UPDATE ... SET`、`WITH ... INSERT/UPDATE/DELETE` 都按真正的目标表判断（字符串字面量和注释里的文字不算），`SELECT ... FOR UPDATE` 不算写。
- **版本留痕**：`params_version`、`tiers_version` 记录计算当天用的 `score_params` / `kol_tiers` 版本（`ctx.config.scoreParams(date)`、`ctx.config.kolTiers(date)`）。

人工调分的数据流：M4 往 `buzz_adjustments` 插一条 `{ project_id, day, value, reason }`（`buzz_snapshot_id` 可选；每个项目每天最多一条未撤销记录，改调分 = 先把旧的 `revoked` 置 true 再插新的；写审计）→ 发 `recalc.requested { reason: "manual_adjust", projectIds: [id], dateFrom, dateTo }` → M3 重算，`adjusted_total = 该日未撤销调整的 value ?? raw_total` → 发 `daily.batch.done`。原始值永远保留。

帖子提及：`post_mentions` 每个候选项目一行（`project_id` 必填），`status` 为 `pending | confirmed | rejected`。M2 写入候选（同名 ticker 等进 `pending`），M4 的确认队列改状态（通过 M2 的接口或事件，`post_mentions` 只归 M2 写），只有 `confirmed` 计入声量。

**PD-01 / PD-02 项目资料列（`projects`，m4-admin 写，M5M6 读）**

| 列 | 类型 | 说明 |
|---|---|---|
| `fundamentals` | JSON | 结构 `FundamentalsSchema`（zod，`@app/shared`）：`capTable: { holder, pct, note? }[]`，另有可选 `summary`、`tokenomics`、`investors`，允许扩展字段 |
| `team` | JSON | 结构 `TeamSchema`：`{ name, role, bio?, url? }[]` |
| `logo_url`、`website_url`、`x_handle`、`docs_url` | 文本 | 基本信息 |
| `users_count`、`users_as_of`、`users_source` | 整数 / 日期 / 文本 | 用户数及口径日期、来源 |
| `coingecko_id` | 文本 | CoinGecko 币种 id，M1 拉价格用 |
| `revenue_usd`、`revenue_period`、`revenue_as_of`、`revenue_source` | Decimal(20,2) / `"30d"\|"quarter"\|"year"` / 日期 / 文本 | 收入 |
| `longge_rating`、`longge_rated_at` | 文本 / 日期 | PD-02 龙哥评级（MVP 手动录入） |

写入前请用 `FundamentalsSchema.parse(...)`、`TeamSchema.parse(...)` 校验。

**待 PRD 更新的新增项（底座已按此实现，等 PRD 补上）**
- `buzz_adjustments`：人工调分记录表（m4-admin 写），按 `project_id + day`，每天最多一条未撤销记录，取代直接改快照。
- `price_snapshots`：币价日快照（m1-collector 写），`price_usd` 可为 null。
- 回补规则：回补/重算统一发 `recalc.requested`（`reason: "manual_backfill"` 等），M3 沿用该日已有快照的 `track_id`（没有则用 `projects.track_id`），按该日生效的 `score_params` / `kol_tiers` 版本计算，缺数据的日子不写行。
- `post_mentions.status`：`pending | confirmed | rejected`，替代原来的"是否人工确认"布尔值。
- `projects.coingecko_id`：CoinGecko 币种 id（m4-admin 写）。
- 另外底座已做、PRD 里还没写的：`kol_tiers` 带版本（`version` + `effective_from`，`people.kol_tier` 存等级名）、`buzz_snapshots.params_version` / `tiers_version`、`system_config` 配置表。

## 7. 事件契约（`@app/shared/events.ts`）

| 事件 | payload | 谁发 |
|---|---|---|
| `post.ingested` | `{ postIds: number[]; platform: string; ingestedAt: string }` | M1 |
| `market.snapshot.ingested` | `{ date: string }`（UTC 日期；每天一次，全部项目行情拉完后发；数据在 `volume_snapshots`） | M1 |
| `recalc.requested` | `{ reason: "weights_changed" \| "manual_adjust" \| "mention_changed" \| "manual_backfill"; projectIds?: number[]; dateFrom: string; dateTo: string }`，不传 projectIds = 全部项目 | M2 / M4 |
| `daily.batch.done` | `{ dateFrom: string; dateTo: string }`（UTC 日期；日批和每次重算后都发） | M3 |

新增事件：在 `EventMap` 里加一行，提 PR 评审。投递保证：至少一次（处理函数要幂等）；失败按配置重试，用尽进死信队列，后台可查 `GET /api/_core/dead-letter`。

前台查询接口（`/rankings`、`/projects/:id`、`/projects/:id/series`、`/projects/:id/posts`）由 M5M6 模块在自己的路由里实现，契约归 M5M6。`@app/shared` 里的 `m5m6` 命名空间（`packages/shared/src/contracts/m5m6.ts`，只按命名空间导出：`import { m5m6 } from "@app/shared"`，不在根上导出以免和底座类型重名）是按 M5M6 草稿改写的**占位 zod 契约**，M5M6 定稿后直接替换。查询参数：`/rankings` 用 `track`、`window`（取自配置 `ranking.windows`）、`date`（默认 UTC 昨天）；`/projects/:id/posts` 用游标分页 `{ cursor?, limit? }`（`limit` 默认 20、最大 50），返回带 `nextCursor: string | null`（`m5m6.projectPostsQuerySchema` / `postsResponseSchema`）。`/rankings` 的每一行和 `noData` 里每一项都有 `detailHref`。接口里的上币阶段用 `m5m6.ApiListingStage = 'teaser'|'spot'|'perp'`；库里 `ListingStage` 仍是 `'preannounce'|'spot'|'perp'`，M5M6 自己映射。不预先算时间窗快照。

**共享工具**：`competitionRank(items, score, id)`（`@app/shared`）——按分数降序、同分按 id 升序，同分同名次、下一名跳号（1,1,3），分数为 null 的不参与。M3 写 `track_rank` / `volume_track_rank`、M5M6 实时排名都用它，保证口径一致。`isValidDay("YYYY-MM-DD")`（`import { isValidDay } from "@app/shared"`，实现在 `packages/shared/src/date.ts`；`m5m6.isValidDay` 是同一个函数，保留兼容）校验 UTC 日期：格式不对或日期不存在（`2026-13-01`、`2026-02-30`）一律返回 false、不抛异常，接口据此返回 400。

**项目资料 JSON 的 zod**：`FundamentalsSchema`（别名 `projectFundamentalsJsonSchema`）、`TeamSchema`（别名 `projectTeamJsonSchema`）、`CapTableEntrySchema`（别名 `capTableRowSchema`）、`TeamMemberSchema`（别名 `teamMemberSchema`）。

## 8. 配置中心（不许写死参数）

读取优先级：**环境变量 `CONFIG_<KEY>` > `system_config` 表 > `@app/shared/config.ts` 默认值**。键名转环境变量：驼峰拆下划线、`.` 和 `-` 换成 `_`、全部大写，例如 `ranking.defaultWindow` → `CONFIG_RANKING_DEFAULT_WINDOW`。环境变量值按 JSON 解析（`[1,7,30]`、`30`、`"UTC"`）。

```ts
const days = await ctx.config.get("posts.refetchDays");          // 7
const params = await ctx.config.scoreParams("2026-10-30");      // 当天生效的 score_params 版本
```

- 管理员查看：`GET /api/_core/config`（列出默认值/库里的值/环境变量/生效值）；修改：`PUT /api/_core/config/<key>` `{ "value": ... }`（需要 `config:write`，会写审计）。
- **模块自己的配置键写在 manifest 里**，键必须以 `<模块名>.` 开头，不能和底座或其他模块的键重复（`pnpm check` 会拦）：
  ```ts
  config: [
    { key: "m3-engine.dailyCron", default: "0 0 * * *", description: "日批 cron" },
    { key: "m3-engine.batchSize", default: 500 },
    { key: "m3-engine.scoreDecimals", default: 2, public: true },   // public: true → 前端可通过 /api/_core/config/public 读
  ],
  jobs: [{ name: "daily", cronKey: "m3-engine.dailyCron", run: async (ctx) => {} }],   // cron 也从配置读
  ```
  底座把它们合并进配置中心，同样可以被 `system_config` 表或环境变量（如 `CONFIG_M3_ENGINE_DAILY_CRON`）覆盖。底座级的键（下表）放在 `@app/shared/config.ts`，改动要提 PR。
- **带版本的打分参数**（不在配置中心里，改动由 m4-admin 新增版本）：
  - `score_params`：只放打分系数（a、b），带 `version` + `effective_from`（UTC 日期）。`await ctx.config.scoreParams("2026-10-30")` 取当天生效版本。
  - `kol_tiers`：各 KOL 等级权重，带 `version` + `effective_from`，一个版本是一整套等级。`await ctx.config.kolTiers("2026-10-30")` → `{ version, effectiveFrom, weights: { S: 3, A: 2, B: 1 } }`。
  - 改参数 = 新增一个版本，不覆盖旧版本；某天用哪版 = `effective_from <= 该日` 的最新版本。
- 回抓天数、时间窗选项、默认时间窗等走配置中心（下表），键名 M4 会直接沿用。

**全部配置键**

| 键 | 默认值 | 说明 |
|---|---|---|
| `time.dayCutTimezone` | `"UTC"` | 切日时区，cron 也按它 |
| `posts.refetchDays` | `7` | 发帖后每天回抓的天数，之后固定 |
| `ranking.windows` | `[1, 7, 30]` | 可选时间窗（天） |
| `ranking.defaultWindow` | `7` | 默认时间窗 |
| `ranking.defaultDateOffsetDays` | `-1` | 默认排名日期 = 今天 + 偏移（-1 = 昨天） |
| `volume.market` | `"spot"` | 交易量口径（现货，合约 V2） |
| `volume.currency` | `"USD"` | 计价货币 |
| `pagination.defaultPageSize` | `20` | 默认分页大小 |
| `pagination.maxPageSize` | `100` | 最大分页大小 |
| `queue.attempts` | `3` | 任务/事件最多执行次数 |
| `queue.backoffType` | `"exponential"` | 重试退避方式 |
| `queue.backoffDelayMs` | `1000` | 退避基础间隔 |
| `queue.deadLetterQueue` | `"dead-letter"` | 死信队列名 |
| `queue.concurrency` | `5` | 每个队列并发 |
| `queue.keepCompleted` / `queue.keepFailed` | `1000` / `1000` | 保留的已完成/失败任务数 |
| `modules.migrationWaitTimeoutMs` | `120000` | worker 等 server 执行模块迁移的最长时间（超时该模块 failed） |
| `modules.migrationPollMs` | `500` | worker 轮询迁移完成的间隔 |
| `external.timeoutMs` | `10000` | 外部服务代理超时（manifest `external.timeoutMs` 可单独设） |
| `external.healthIntervalMs` | `15000` | 外部服务健康检查间隔 |
| `external.healthTimeoutMs` | `3000` | 健康检查超时 |
| `auth.jwtExpires` | `"12h"` | 登录有效期 |
| `<模块名>.*` | 各模块 manifest `config` 里声明 | 模块自己的参数（如 `m3-engine.dailyCron`），用任务的 `cronKey` 引用 |

启动期参数（队列重试/并发、健康检查间隔、JWT 有效期）只认环境变量和默认值，改了要重启；其他参数改库立即生效（30 秒缓存）。

### 8.1 前端读配置、调接口（`@app/ui`）

```tsx
import { api, useApi, useConfig, getConfig, TOKEN_KEY, type ModulePageProps } from "@app/ui";
const data = await api("/api/m6-project/projects/1");                         // 自动带登录 token；出错抛出统一错误里的 message
await api("/api/example/notes", { method: "POST", json: { text: "hi" } });     // json 自动序列化
const { data, error, loading, reload } = useApi("/api/example/notes");        // React hook
const { value: windows } = useConfig<number[]>("ranking.windows");            // 前端可读配置
```

- `api()` 是官方的调接口方式：自动加 `Authorization: Bearer <token>`，401 跳登录页。出错时抛 `ApiError`（`@app/ui` 导出）：`e.status` 是 HTTP 状态码，`e.code` 是统一错误体里的 code（如 `FORBIDDEN`、`MODULE_TIMEOUT`），`e.message` 是中文说明。token 存在 `localStorage[TOKEN_KEY]`，键名默认 `dashboard_token`，可用环境变量 `NEXT_PUBLIC_TOKEN_KEY` 改，代码里用 `TOKEN_KEY` 常量，别写死。
- 前端可读配置：`GET /api/_core/config/public`（登录后可读），只返回白名单：`time.dayCutTimezone`（IANA 时区名，默认 `"UTC"`）、`ranking.windows`、`ranking.defaultWindow`，以及模块 manifest 里标了 `public: true` 的键。密钥不要标 public。

## 9. 两种接入方式

### 9.1 代码内模块（TypeScript）
照第 3、4 节做即可，参考 `modules/example`（路由、自有表读写、审计、收发事件、定时任务、前后台页面、权限全都有）。

### 9.2 外部服务模块（Python / Go / 已有的 Express 等）
目录里放 `module.manifest.json`（字段同上，另加 `kind: "external"` 和 `external`），服务自己跑。参考 `modules/py-example`（FastAPI）。

```json
{ "apiVersion": 1, "name": "m1-collector", "version": "1.0.0", "kind": "external",
  "external": { "baseUrl": "${M1_URL:-http://localhost:8001}", "health": "/health", "transport": "http", "timeoutMs": 5000 },
  "subscribes": [], "emits": ["post.ingested"], "adminMenu": [{ "path": "/", "title": "采集", "url": "/ui" }],
  "config": [{ "key": "m1-collector.fetchCron", "default": "10 0 * * *" }], "jobs": [{ "name": "fetch", "cronKey": "m1-collector.fetchCron" }] }
```

服务要实现的约定：

| 方向 | 约定 |
|---|---|
| 健康检查 | `GET /health` 返回 200；失败会被标成"不可用"，代理返回 503，菜单置灰，恢复后自动恢复 |
| 底座代理 | `/api/<name>/<path>` → `<baseUrl>/<path>`，带 `x-user-id`、`x-user-role` 头；超时返回 504 |
| 收事件 | `transport: "http"`：底座 `POST <baseUrl>/_events`，body `{event, from, at, id, payload}`，非 2xx 会重试；`transport: "redis"`：自己用 BullMQ 客户端消费队列 `mod.<name>` |
| 发事件 | `POST <底座>/api/_core/events`，头 `x-module-name: <name>`、`x-module-token: $MODULE_TOKEN`，body `{event, payload}`；只能发 manifest `emits` 里声明的事件 |
| 定时任务 | manifest `jobs: [{ "name": "tick", "cronKey": "<name>.tickCron" }]` + `config` 里给默认 cron，底座按时 `POST <baseUrl>/_jobs/<name>` |
| 后台页面 | `adminMenu[].url` 指向服务里的一个 HTML 页面；底座把它放进同源 iframe，页面里可以用 `localStorage.dashboard_token` 调 `/api/...` |
| 数据库 | 直接连同一个 Postgres，只写 `m_<name>_*` 自有表和归属给自己的核心表；自有表迁移同样放 `migrations/*.sql`，由底座执行 |

### 9.3 已有代码怎么适配（不用重写）
- **已有 Express / Koa / FastAPI / Gin 服务**：走 9.2。补一份 `module.manifest.json`，再加一层很薄的 adapter：`/health`、`/_events`（把事件转给原来的处理函数）、需要时 `/_jobs/<name>`；原有业务路由不用动，底座按 `/api/<name>/*` 代理过去。
- **已有一段 TS 函数/类库（非服务）**：写一个 `module.manifest.ts`，在 `register` 里把原函数挂成路由或事件处理函数即可。Express 风格的 handler 可以包一下：`ctx.router.get("/x", async (req, reply) => legacyHandler(req.query))`。
- **原来自己连库/建表**：表名改成 `m_<name>_*` 前缀，建表 SQL 挪到 `migrations/`；核心表的数据改为读取，写入改成调归属模块的接口或发事件。
- **原来写死的参数**：挪到配置中心（第 8 节）。

## 9.1 迁移由谁执行（server / worker 并发启动）

- **核心表**：`pnpm db:migrate`（docker compose 里是单独的 `migrate` 服务，server/worker 都等它成功后才启动）。
- **模块自有表**：只有 **server** 执行模块迁移；每条迁移在事务里先拿 `pg_advisory_xact_lock` 再复查是否已执行，所以多个 server 同时启动也只跑一次。
- **worker 不跑迁移**：启动时轮询 `_module_migrations`，等本模块所有迁移都被 server 执行完才 register/start；超过 `modules.migrationWaitTimeoutMs`（默认 120000，轮询间隔 `modules.migrationPollMs` 默认 500）该模块标记 failed，日志写明"等待 server 执行迁移超时，缺：…"。其他模块不受影响。
- 测试：`pnpm test:migrate-race`（worker 先起、两个 server 同时起，迁移只执行一次，worker 不会读到不存在的表）。

## 10. 合并检查清单（每个同事模块合并前过一遍）

- [ ] 目录 `modules/<name>/`，名字符合规范，没有改 `packages/`、`apps/` 下任何文件
- [ ] `module.manifest.*` 有 `apiVersion: 1`、合法 `version`、`requires.core` 覆盖当前底座版本
- [ ] `pnpm check --module <目录>` 通过（manifest、表前缀、迁移只动自有表、`tables.writes` 符合写入归属、配置键前缀、没有 `$queryRawUnsafe` / `$executeRaw*`）
- [ ] `pnpm typecheck`、`pnpm lint`（含 dependency-cruiser：没有跨模块 import、没有直接 import `@app/db`/`@prisma/client`）通过
- [ ] 订阅的事件都在 `subscribes` 里声明且注册了处理函数，处理函数幂等
- [ ] 人工修改数据的地方都调了 `ctx.audit`
- [ ] 没有写死的天数、时间窗、超时、cron、分页大小，都走配置中心；模块配置键都以 `<模块名>.` 开头
- [ ] 外部服务模块：`/health`、`/_events` 实现了；docker-compose 里加了它的服务
- [ ] 本地 `pnpm demo` 仍全部通过；后台"已接入模块"里状态为 started

## 11. 底座账号接口（AD-07 用）

users 表只有底座写。下列接口都需要 `users:manage` 权限（默认只有 admin），每次修改都写审计（不记录密码）。

| 接口 | 说明 |
|---|---|
| `GET /api/_core/users` | 列表（不含密码哈希） |
| `POST /api/_core/users` `{ email, name, role?, password? }` | 新建；不传 password 时返回随机 `initialPassword` |
| `PATCH /api/_core/users/:id/role` `{ role }` | 改角色（admin / editor / viewer），不能改自己 |
| `POST /api/_core/users/:id/disable`、`/enable` | 停用 / 启用；不能停用自己；停用后不能登录 |
| `POST /api/_core/users/:id/reset-password` `{ password? }` | 重置密码；不传时返回随机 `newPassword` |

## 12. 常用命令

| 命令 | 作用 |
|---|---|
| `docker compose up --build` | 一键起整套（Postgres、Redis、迁移+假数据、server、worker、web、Python 示例） |
| `pnpm check` | 校验 `modules/` 下所有模块（manifest、表前缀、写入归属、配置键前缀、禁止的原生 SQL 和 import） |
| `pnpm check --dir <目录>` | 目录本身有 `module.manifest.ts/json` 就当成一个模块校验；否则校验它下面每个子目录里的模块。例：`pnpm check --dir /workspace/m4-admin`（默认含类型检查，`--no-typecheck` 跳过） |
| `pnpm check --module <模块目录>` | 只校验一个模块，**可在仓库外、不需要模块自己的 node_modules**：会把模块拷到仓库内临时目录 `.check-staging/`（原目录只读不改），`@app/core`/`@app/shared`/`@app/ui`/react 从底座 workspace 解析；和仓库已有模块一起查依赖和配置键冲突；再做两遍类型检查：后端用 `tsconfig.module.json`（NodeNext，相对 import 写 `.js`），`web/` 用 `tsconfig.module.web.json`（Next.js 口径），错误以「类型检查(后端)/(前端):」开头列出。例：`pnpm check --module /workspace/m4-admin` |
| `pnpm module:new <name>` | 从模板创建模块 |
| `pnpm module:uninstall <name> [--keep-files]` | 卸载：删自有表/队列/定时任务，目录移到 `.uninstalled/` |
| `pnpm demo` | 验收脚本：注册→挂载→菜单→读写自有表→审计→事件→定时任务→Python 模块→卸载 |
| `pnpm test:ownership` / `pnpm test:config` / `pnpm test:api` / `pnpm test:shared` | 写入归属和原生 SQL 拦截 / 配置中心与版本 / 账号接口与外部模块超时(504) / 共享工具（competitionRank 等） |
| `pnpm --filter @app/db migrate:new <名字>` | 改核心表后生成迁移（需要 `SHADOW_DATABASE_URL`） |
