# m4-admin — M4 后台管理（AD-01 ~ AD-07）

代码内模块（Node/TS），按底座 M0 正式版 `docs/MODULE_GUIDE.md`（底座 1.1.0，apiVersion 1）适配。放进底座 `modules/m4-admin/` 即可自动加载，不改底座代码。
接口挂在 `/api/m4-admin/*`，后台菜单 7 项由 manifest `adminMenu` 生成，页面由底座 admin 外壳 + ModuleErrorBoundary 包裹。

## 完成情况
| 项 | 页面 | 接口 | 状态 |
|---|---|---|---|
| AD-01 项目与上币事件 | ProjectsPage | `/projects`（赛道必填，前后端都校验；改赛道只更新 projects.track_id；PD-01/02 全部列含 `coingecko_id`：两级赛道选择、链接、用户数、收入、龙哥评级；fundamentals/team 用结构化编辑器并按 `@app/shared` 的 zod schema 校验）`/contracts` `/listings`（交易所下拉 → exchange_id，阶段下拉）| ✅ |
| AD-02 人物池与标签 | PeoplePage | `/people` `/person-tags` CRUD，`/platforms` 只读 | ✅ |
| AD-03 权重配置 | WeightsPage | `GET/POST /score-params`（只放 a/b 系数，版本 + 生效日，版本历史）；KOL 权重：`/kol-tiers/versions` 每次保存一整套等级为新版本 + 生效日，显示历史，发 weights_changed；`GET /kol-tiers` 用 `ctx.config.kolTiers(date)` 取当天生效版本；`GET /system-config` 只读展示回看天数/窗口；独立「手动回算」按钮（`POST /backfill`） | ✅ |
| AD-04 快照调分 | AdjustPage | `GET /snapshots` `GET/POST /adjustments`：按 project_id + day 写 `buzz_adjustments`，每天最多一条未撤销（先撤销旧的再插新的），允许无快照或 raw_total 为 null 的日子（UI 标「补分」，理由前后端都必填，否则报「当天无快照，补分须填写理由」）；留空 = 撤销 | ✅ |
| AD-05 别名 | AliasesPage | `/aliases` CRUD（写核心表 project_aliases，M2 直接读，不发事件） | ✅ |
| AD-06 确认队列 | ReviewPage | 按 `post_mentions.status`（pending/confirmed/rejected/all）筛选显示； `GET /review-queue` → M2 `GET /review-queue`；`POST /review/posts/:postId` → M2 `POST /api/m2-matcher/review/posts/:postId`，body `{ projectIds: number[] }`：按帖子分组多选，勾选=confirmed、未勾选=rejected、空数组=该帖 pending 候选全部驳回（路径/请求体只在 `src/config.ts` 的 `ENDPOINTS.m2ReviewPost` / `buildM2ReviewBody`；旧的按 mention 提交接口已删除）。M2 不通时用私有表假数据 | ✅（假数据） |
| AD-07 赛道与账号 | TracksPage | `/tracks` CRUD（两级，上级下拉）；账号调底座 `/api/_core/users` | ✅ 账号：列表/新建/改角色/停用启用/重置密码，全走底座 `/api/_core/users`（需 users:manage） |

## 事件
只发 `recalc.requested`，形状严格用 `@app/shared` 的 `RecalcRequestedEvent`：`{ reason, projectIds?: number[], dateFrom, dateTo }`。操作人、参数版本只记审计日志。
- 保存权重：`weights_changed`，生效日 ~ 今天
- 「手动回算」按钮（`POST /backfill`，日期范围 + 可选项目 + 确认框）：`manual_backfill`
- 人工调分：`manual_adjust`，`projectIds:[id]`，当天

## 数据与权限
- 写核心表全部走 `ctx.db.core`（底座按 `tables.writes` 做表/列级拦截），每次写都 `ctx.audit(...)`；不直接写 audit_logs、post_mentions、buzz_snapshots 的计算列、users。
- `tables.writes`：projects, project_contracts, project_aliases, listing_events, tracks, people, person_tags, score_params, kol_tiers, buzz_adjustments（不声明 buzz_snapshots）。
- 私有表：`m_m4_admin_mock_review`（M2 假数据，register 时自动塞 3 组帖子（含多候选，候选带 status））。注意底座按模块名推导前缀是 `m_m4_admin_`，不是 `m_m4_`。
- 权限：`m4-admin:write`（admin、editor）；菜单需 `admin:access`。

## 配置
- 本模块键在 manifest `config` 声明（`src/config.ts` 的 `CONFIG`），可用 system_config 或 `CONFIG_M4_ADMIN_*` 覆盖：
  ``m4-admin.m2BasePath`(/api/m2-matcher)、`m4-admin.m2Mock`(auto/on/off)、`m4-admin.m2TimeoutMs`(5000)、`m4-admin.backfillFrom`(2025-01-01，public，前端 useConfig 读)。
- 共享键直接读配置中心：`posts.refetchDays`、`ranking.windows`、`ranking.defaultWindow`（权重页只读展示），`pagination.defaultPageSize` / `pagination.maxPageSize`（列表分页）。
- 其他常量（事件名、reason、权限、表名、接口路径、上币阶段、项目字段）集中在 `src/config.ts`。
- score_params 只放 a/b（版本 + 生效日）；KOL 权重在 kol_tiers（版本 + 生效日）。

## 合并 / 卸载
`pnpm check`（或 `pnpm check --module modules/m4-admin`）→ `pnpm typecheck` → `pnpm lint` → 启动看 `/api/_core/modules`。卸载：`pnpm module:uninstall m4-admin`（只删 m_m4_admin_*）。
示例请求见 `seed/demo-payloads.json`。

## 空值约定
`buzz_snapshots.raw_total` 及三个子项可为 null（只有人工调整、无原始数据），页面显示「—」，按补分处理，不做运算；`project_daily` M4 不读。

## 错误码与校验
- AD-01~05 新建/修改：必填缺失、类型/日期/枚举不对 → 400（中文提示字段名）；唯一冲突 → 409；记录不存在 → 404；外键不存在 → 400。
- 赛道：被项目/快照/子赛道使用 → 409「该赛道已被使用，不能删除，请改用停用」（预检 + 捕获外键 Restrict）。停用/启用（`POST /tracks/:id/disable|enable`）在底座有 `tracks.disabled_at` 后自动启用（`tracksDisableSupported`，config.ts），停用赛道不能新分配给项目，已在其上的项目保留。
- AD-06 调 M2：进程内经底座路由调用（不需要底座地址/端口）；M2 的 400/401/403/404 透传（404 提示「该帖子已审核或不存在」并刷新队列），不可达 502，超时 503；`m4-admin.m2Mock` 为枚举 auto|on|off（默认 off；非法值按 off，不自动回退假数据）。
- 日期：“今天”按配置 `time.dayCutTimezone` 计算，不写死时区。
- 迁移全部幂等（IF NOT EXISTS）。

## 集成测试
`/workspace/m4-admin-it/it-m4.ts`（放在模块目录外，因为 pnpm check 禁止模块目录里直连 @app/db）：真 Postgres（embedded-postgres 端口 55440）+ 真 ModuleHost + 进程内事件总线；阶段 1 只装 M4（M2 不可达），阶段 2 与真 m2-matcher 联调。用法见文件头。
