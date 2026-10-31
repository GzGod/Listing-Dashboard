import { AppError, type ModuleContext } from "@app/core";
import { type M4RecalcRequested, today, emitRecalc, toIds, isValidDay } from "./recalc.js";
import { FundamentalsSchema, TeamSchema, RevenuePeriodSchema } from "@app/shared";
import { M2_MODULE, REVIEW_404_MSG, ALIAS_KINDS, TRACK_IN_USE_MSG, tracksDisableSupported, NO_SNAPSHOT_REASON_MSG, buildM2ReviewBody, parseReviewInput, PROJECT_FIELDS, PROJECT_DATE_FIELDS, LISTING_STAGES, PERMS, TABLES, OWN, ENDPOINTS, RECALC_REASONS, SYSTEM_CONFIG_KEYS, runtime } from "./config.js";

type Req = { body?: any; params?: any; query?: any; user?: { id: number }; headers: Record<string, any> };
const W = PERMS.write;
const day = (s: string) => { const d = String(s).slice(0, 10); if (!isValidDay(d)) throw new AppError(400, "BAD_INPUT", `日期格式应为 YYYY-MM-DD：${s}`); return new Date(`${d}T00:00:00Z`); };
const num = (v: any) => (v === "" || v == null ? null : Number(v));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** 下一个版本号：取已有 <前缀><数字> 的最大值 + 1（不按条数算，删过版本也不会撞号） */
const nextVersion = async (prefix: string, existing: string[]) => `${prefix}${Math.max(0, ...existing.map((v) => (v.startsWith(prefix) ? Number(v.slice(prefix.length)) : 0)).filter(Number.isFinite)) + 1}`;

/** 通用 CRUD：核心表写入走 Prisma（manifest tables.writes 已声明），每次写都 ctx.audit */
/** Prisma 已知错误转统一 4xx：唯一冲突 409、外键 400/409、记录不存在 404 */
export function mapDbError(e: any, conflictMsg?: string): never {
  const code = e?.code;
  if (code === "P2002") throw new AppError(409, "CONFLICT", `重复：${(e.meta?.target ?? []).toString() || "唯一字段"} 已存在`);
  if (code === "P2003") throw new AppError(conflictMsg ? 409 : 400, conflictMsg ? "IN_USE" : "BAD_REFERENCE", conflictMsg ?? `关联的记录不存在（${e.meta?.field_name ?? "外键"}）`);
  if (code === "P2025") throw new AppError(404, "NOT_FOUND", "记录不存在");
  if (e?.name === "PrismaClientValidationError") throw new AppError(400, "BAD_INPUT", "字段类型或必填项不对");
  throw e;
}
const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && Number.isNaN(v));

/** 通用 CRUD：核心表写入走 Prisma（manifest tables.writes 已声明），每次写都 ctx.audit；必填字段缺失返回 400 */
function crud(ctx: ModuleContext, path: string, model: string, table: string, fields: string[],
  opts: { include?: any; orderBy?: any; map?: (b: any, isCreate: boolean) => any; required?: Record<string, string>; beforeDelete?: (id: number) => Promise<void>; deleteConflictMsg?: string; check?: (d: any, id: number | null) => Promise<void> } = {}) {
  const m = (ctx.db.core as any)[model];
  const req0 = opts.required ?? {};
  const data = (b: any, isCreate = false) => {
    if (b != null && typeof b !== "object") throw new AppError(400, "BAD_INPUT", "请求体必须是 JSON 对象");
    const out = opts.map ? opts.map(pick(b, fields), isCreate) : pick(b, fields);
    const missing = Object.entries(req0).filter(([k]) => (isCreate ? isBlank(out[k]) : k in out && isBlank(out[k]))).map(([, label]) => label);
    if (missing.length) throw new AppError(400, "BAD_INPUT", `缺少必填字段：${missing.join("、")}`);
    if (!isCreate && !Object.keys(out).length) throw new AppError(400, "BAD_INPUT", "没有要修改的字段");
    return out;
  };
  const pre = { preHandler: ctx.requirePermission(W) };
  const idOf = (req: Req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "BAD_INPUT", "id 不合法"); return id; };
  ctx.router.get(path, async (req: Req) => { const rt = await runtime(ctx); const take = Math.min(Number(req.query?.pageSize ?? rt.pageSize), rt.maxPageSize); const skip = (Math.max(Number(req.query?.page ?? 1), 1) - 1) * take;
    return m.findMany({ include: opts.include, orderBy: opts.orderBy ?? { id: "asc" }, take, skip }); });
  ctx.router.post(path, pre, async (req: Req) => {
    const d = data(req.body ?? {}, true);
    if (opts.check) await opts.check(d, null);
    const row = await m.create({ data: d }).catch((e: any) => mapDbError(e));
    await ctx.audit({ action: "create", table, recordId: row.id, after: row, actorId: req.user?.id });
    return row;
  });
  ctx.router.put(`${path}/:id`, pre, async (req: Req) => {
    const id = idOf(req);
    const d = data(req.body ?? {});
    const before = await m.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "NOT_FOUND", "记录不存在");
    if (opts.check) await opts.check(d, id);
    const row = await m.update({ where: { id }, data: d }).catch((e: any) => mapDbError(e));
    await ctx.audit({ action: "update", table, recordId: id, before, after: row, actorId: req.user?.id });
    return row;
  });
  ctx.router.delete(`${path}/:id`, pre, async (req: Req) => {
    const id = idOf(req);
    if (opts.beforeDelete) await opts.beforeDelete(id);
    const before = await m.delete({ where: { id } }).catch((e: any) => mapDbError(e, opts.deleteConflictMsg));
    await ctx.audit({ action: "delete", table, recordId: id, before, actorId: req.user?.id });
    return { ok: true };
  });
}

export function registerRoutes(ctx: ModuleContext) {
  const r = ctx.router;
  const pre = { preHandler: ctx.requirePermission(W) };

  // AD-01 项目 / 合约 / 上币事件
  const bad = (msg: string) => new AppError(400, "BAD_INPUT", msg);
  const projectData = (b: any, isCreate: boolean) => {
    const o: any = { ...b };
    if (o.trackId !== undefined) o.trackId = num(o.trackId);
    // 赛道必填：没有 track_id 的项目 M3 不写 project_daily（schema 里可空，这里由 M4 强制）
    if ((isCreate || o.trackId !== undefined) && (o.trackId == null || !Number.isInteger(o.trackId) || o.trackId <= 0)) throw bad("赛道必填（请选择一级或细分赛道）");
    if (o.usersCount !== undefined) o.usersCount = num(o.usersCount);
    if (o.revenueUsd !== undefined) o.revenueUsd = o.revenueUsd === "" || o.revenueUsd == null ? null : String(o.revenueUsd);
    for (const k of PROJECT_DATE_FIELDS) if (o[k] !== undefined) o[k] = o[k] ? day(o[k]) : null;
    for (const k of ["coingeckoId", "logoUrl", "websiteUrl", "xHandle", "docsUrl", "usersSource", "revenueSource", "longgeRating", "revenuePeriod"]) if (o[k] === "") o[k] = null;
    if (o.revenuePeriod != null && !RevenuePeriodSchema.safeParse(o.revenuePeriod).success) throw bad("revenuePeriod 只能是 30d / quarter / year");
    // 改赛道只更新 projects.track_id（当前赛道），历史快照的 track_id 由 M3 沿用，不建历史表
    if (o.fundamentals != null) { const r = FundamentalsSchema.safeParse(o.fundamentals); if (!r.success) throw bad("fundamentals 结构不对：" + r.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")); o.fundamentals = r.data; }
    if (o.team != null) { const r = TeamSchema.safeParse(o.team); if (!r.success) throw bad("team 结构不对：" + r.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")); o.team = r.data; }
    return o;
  };
  crud(ctx, "/projects", "project", TABLES.projects, [...PROJECT_FIELDS], { include: { track: { include: { parent: true } }, contracts: true }, map: projectData, check: async (d, id) => {
    if (d.trackId == null) return;
    const t = await ctx.db.core.track.findUnique({ where: { id: d.trackId } });
    if (!t) throw bad(`赛道 ${d.trackId} 不存在`);
    // 停用的赛道不能新分配；已经在该赛道上的项目可以保留
    if ((await tracksDisableSupported(ctx)) && (t as any).disabledAt) {
      const cur = id ? await ctx.db.core.project.findUnique({ where: { id }, select: { trackId: true } }) : null;
      if (cur?.trackId !== d.trackId) throw bad(`赛道「${t.name}」已停用，不能选`);
    }
  }, required: { name: "名称 name", symbol: "Ticker symbol", trackId: "赛道 trackId" } });
  r.get("/projects/:id", async (req: Req) => ctx.db.core.project.findUnique({ where: { id: Number(req.params.id) }, include: { track: true, contracts: true, listings: { include: { exchange: true } } } }));
  crud(ctx, "/contracts", "projectContract", TABLES.contracts, ["projectId", "chain", "address"], { map: (b) => ({ ...b, projectId: num(b.projectId) ?? undefined }), required: { projectId: "项目 projectId", chain: "链 chain", address: "地址 address" } });
  crud(ctx, "/listings", "listingEvent", TABLES.listings, ["projectId", "exchangeId", "day", "stage", "pair", "announcementUrl"],
    { include: { project: true, exchange: true }, orderBy: { day: "desc" }, map: (b) => { if (b.stage !== undefined && !(LISTING_STAGES as readonly string[]).includes(b.stage)) throw bad(`stage 只能是 ${LISTING_STAGES.join(" / ")}`); return { ...b, projectId: num(b.projectId) ?? undefined, exchangeId: num(b.exchangeId) ?? undefined, day: b.day ? day(b.day) : undefined, announcementUrl: b.announcementUrl === "" ? null : b.announcementUrl }; }, required: { projectId: "项目 projectId", exchangeId: "交易所 exchangeId", day: "日期 day", stage: "阶段 stage" } });
  r.get("/listing-stages", async () => LISTING_STAGES);
  r.get("/exchanges", async () => ctx.db.core.exchange.findMany({ orderBy: { id: "asc" } })); // 只读下拉

  // AD-02 人物池 / KOL 分级 / 标签
  crud(ctx, "/people", "person", TABLES.people, ["displayName", "handle", "platformId", "kolTier", "enabled"],
    { include: { tags: true, platform: true }, map: (b) => ({ ...b, platformId: num(b.platformId) ?? undefined, kolTier: b.kolTier === "" ? null : b.kolTier, enabled: b.enabled === undefined ? undefined : b.enabled === true || b.enabled === "true" }), required: { displayName: "名称 displayName", handle: "账号 handle", platformId: "平台 platformId" } });
  crud(ctx, "/person-tags", "personTag", TABLES.personTags, ["personId", "tag"], { map: (b) => ({ ...b, personId: num(b.personId) ?? undefined }), required: { personId: "人物 personId", tag: "标签 tag" } });
  r.get("/platforms", async () => ctx.db.core.platform.findMany({ orderBy: { id: "asc" } }));

  // AD-03 权重：每次保存新增一个版本行并设为生效，旧版本保留
  r.get("/score-params", async () => ctx.db.core.scoreParams.findMany({ orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }] }));
  // KOL 权重：kol_tiers 带 version + effectiveFrom，一个版本 = 一整套等级；改权重 = 新增版本
  r.get("/kol-tiers", async (req: Req) => (await ctx.config.kolTiers(req.query?.date)) ?? null); // 某天生效的那套（默认今天）
  r.get("/kol-tiers/versions", async () => {
    return { rows: await ctx.db.core.kolTier.findMany({ orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }, { name: "asc" }] }) };
  });
  r.post("/kol-tiers/versions", pre, async (req: Req) => {
    const b = req.body ?? {};
    const effectiveFrom = String(b.effectiveFrom || (await today(ctx))).slice(0, 10);
    const weights: Record<string, number> = b.weights ?? {};
    if (!isValidDay(effectiveFrom) || !Object.keys(weights).length || Object.values(weights).some((w) => Number.isNaN(Number(w)))) throw bad("effectiveFrom、weights{分级名: 权重} 必填");
    const m = ctx.db.core.kolTier;
    const version = String(b.version || (await nextVersion("k", (await m.findMany({ select: { version: true } })).map((x) => x.version))));
    const rows = await ctx.db.core.$transaction(Object.entries(weights).map(([name, w]) => m.create({ data: { name, weight: Number(w), version, effectiveFrom: day(effectiveFrom), createdBy: req.user?.id ?? null } }))).catch((e: any) => mapDbError(e));
    await ctx.audit({ action: "kol_weights_version", table: TABLES.kolTiers, recordId: version, after: { version, effectiveFrom, weights }, actorId: req.user?.id });
    const ev: M4RecalcRequested = { reason: RECALC_REASONS.weightsChanged, dateFrom: effectiveFrom, dateTo: (await today(ctx)) };
    await emitRecalc(ctx, ev);
    return { version, rows, event: ev };
  });
  r.get("/system-config", async () => {
    const out: Record<string, unknown> = {};
    for (const [k, key] of Object.entries(SYSTEM_CONFIG_KEYS)) out[k] = await ctx.config.get(key);
    return { keys: SYSTEM_CONFIG_KEYS, values: out };
  });
  r.post("/score-params", pre, async (req: Req) => {
    const b = req.body ?? {};
    const effectiveFrom = String(b.effectiveFrom || (await today(ctx))).slice(0, 10);
    const db = ctx.db.core;
    if (!isValidDay(effectiveFrom) || [b.a, b.b].some((x) => x === "" || x == null || Number.isNaN(Number(x)))) throw bad("a、b 必填且为数字，effectiveFrom 为 YYYY-MM-DD");
    const prev = await db.scoreParams.findFirst({ orderBy: { effectiveFrom: "desc" } });
    const version = String(b.version || (await nextVersion("v", (await db.scoreParams.findMany({ select: { version: true } })).map((x) => x.version))));
    // score_params 只放打分系数：version + effective_from + a/b
    const row = await db.scoreParams.create({ data: { version, effectiveFrom: day(effectiveFrom), a: Number(b.a), b: Number(b.b), updateFrequency: b.updateFrequency ?? "daily", createdBy: req.user?.id ?? null } }).catch((e: any) => mapDbError(e));
    await ctx.audit({ action: "activate", table: TABLES.scoreParams, recordId: row.id, before: prev, after: { ...row, event: RECALC_REASONS.weightsChanged }, actorId: req.user?.id });
    const ev: M4RecalcRequested = { reason: RECALC_REASONS.weightsChanged, dateFrom: effectiveFrom, dateTo: (await today(ctx)) };
    await emitRecalc(ctx, ev);
    return { params: row, event: ev };
  });

  // AD-03 手动回算：单独按钮，日期范围 + 可选项目，只发 manual_backfill（不改参数）
  r.post("/backfill", pre, async (req: Req) => {
    const b = req.body ?? {};
    const dateFrom = String(b.dateFrom || (await runtime(ctx)).backfillFrom).slice(0, 10), dateTo = String(b.dateTo || (await today(ctx))).slice(0, 10);
    if (!isValidDay(dateFrom) || !isValidDay(dateTo) || dateFrom > dateTo) throw bad("日期范围不合法");
    const projectIds = toIds(b.projectIds);
    const ev: M4RecalcRequested = { reason: RECALC_REASONS.manualBackfill, dateFrom, dateTo, ...(projectIds ? { projectIds } : {}) };
    const params = await ctx.config.scoreParams(dateTo);
    await ctx.audit({ action: "manual_backfill", table: undefined, after: { ...ev, paramsVersion: params?.version ?? null }, actorId: req.user?.id });
    await emitRecalc(ctx, ev);
    return { event: ev };
  });

  // AD-04 人工调分：buzz_adjustments 按 project_id + day，每天最多一条未撤销记录（改调分 = 撤销旧的再插新的），允许当天还没有快照
  r.get("/snapshots", async (req: Req) => {
    const q = req.query ?? {};
    return ctx.db.core.buzzSnapshot.findMany({ where: { ...(q.projectId ? { projectId: Number(q.projectId) } : {}), ...(q.day ? { day: day(q.day) } : {}) }, include: { project: true }, orderBy: [{ day: "desc" }, { projectId: "asc" }], take: (await runtime(ctx)).maxPageSize });
  });
  r.get("/adjustments", async () => ctx.db.core.buzzAdjustment.findMany({ include: { project: true, buzzSnapshot: true }, orderBy: { id: "desc" }, take: (await runtime(ctx)).maxPageSize }));
  r.post("/adjustments", pre, async (req: Req) => {
    const b = req.body ?? {};
    const projectId = Number(b.projectId), d = String(b.day || (await today(ctx))).slice(0, 10), reason = String(b.reason ?? "").trim();
    const clear = b.adjustedScore === null || b.adjustedScore === "" || b.clear === true; // 清除 = 只撤销
    const score = clear ? null : Number(b.adjustedScore);
    if (!projectId || !isValidDay(d) || (score !== null && Number.isNaN(score))) throw bad("projectId、day(YYYY-MM-DD)、adjustedScore 必填");
    const db = ctx.db.core;
    const snap = await db.buzzSnapshot.findUnique({ where: { projectId_day: { projectId, day: day(d) } } });
    const noRaw = !snap || snap.rawTotal == null; // 补分：当天无快照，或有快照但 raw_total 为 null（只有人工调整、没有原始数据）
    if (noRaw && !reason && score !== null) throw bad(NO_SNAPSHOT_REASON_MSG);
    if (!reason) throw bad("reason 必填");
    const before = await db.buzzAdjustment.findMany({ where: { projectId, day: day(d), revoked: false } });
    const after = await db.$transaction(async (tx) => {
      await tx.buzzAdjustment.updateMany({ where: { projectId, day: day(d), revoked: false }, data: { revoked: true } });
      return score === null ? null : tx.buzzAdjustment.create({ data: { projectId, day: day(d), buzzSnapshotId: snap?.id ?? null, value: score, reason, createdBy: req.user?.id ?? null } });
    });
    const params = await ctx.config.scoreParams(d);
    await ctx.audit({ action: clear ? "manual_adjust_revoke" : noRaw ? "manual_adjust_fill" : "manual_adjust", table: TABLES.buzzAdjustments, recordId: after?.id ?? `${projectId}:${d}`, before, after: { row: after, paramsVersion: params?.version ?? null, hasSnapshot: !!snap, rawTotal: snap?.rawTotal ?? null }, actorId: req.user?.id });
    const ev: M4RecalcRequested = { reason: RECALC_REASONS.manualAdjust, dateFrom: d, dateTo: d, projectIds: [projectId] };
    await emitRecalc(ctx, ev);
    return { adjustment: after, revoked: before.length, fill: noRaw, event: ev };
  });

  // AD-05 别名（M2 直接读核心表，不发事件）
  crud(ctx, "/aliases", "projectAlias", TABLES.aliases, ["projectId", "alias", "kind"], { include: { project: true }, map: (b) => { if (b.kind !== undefined && b.kind !== "" && !(ALIAS_KINDS as readonly string[]).includes(b.kind)) throw bad(`kind 只能是 ${ALIAS_KINDS.join(" / ")}`); return { ...b, projectId: num(b.projectId) ?? undefined }; }, required: { projectId: "项目 projectId", alias: "别名 alias", kind: "类型 kind" } });

  // AD-06 确认队列：只调 M2 接口，不写 post_mentions；M2 不在线时用私有表假数据
  // 进程内经底座路由调 M2（不需要底座地址/端口）；不可达 → 502，超时 → 503
  const callM2 = async (req: Req, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}) => {
    const rt = await runtime(ctx);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new AppError(503, "M2_TIMEOUT", `M2 超过 ${rt.m2TimeoutMs}ms 未响应`)), rt.m2TimeoutMs); });
    try {
      const res = await Promise.race([ctx.router.inject({ method: init.method ?? "GET", url: rt.m2BasePath + path, headers: { authorization: req.headers.authorization ?? "" }, ...(init.body !== undefined ? { payload: init.body as any } : {}) }), timeout]);
      let errBody: any = null; try { errBody = res.json(); } catch { /* 非 JSON */ }
      // 底座统一错误体带 module：不是 M2 自己返回的 404（路由不存在/模块未加载）= 不可达
      if (res.statusCode === 404 && errBody?.error?.module !== M2_MODULE) throw new AppError(502, "M2_UNREACHABLE", "M2（m2-matcher）未加载或接口不存在");
      if (res.statusCode >= 500) throw new AppError(res.statusCode === 504 ? 503 : 502, res.statusCode === 504 ? "M2_TIMEOUT" : "M2_UNREACHABLE", `M2 返回 ${res.statusCode}`);
      if (res.statusCode >= 400) { // 400/401/403/404 原样透传状态码，给友好提示
        let msg = errBody?.error?.message ?? res.body;
        if (res.statusCode === 404) msg = REVIEW_404_MSG;
        throw new AppError(res.statusCode, res.statusCode === 404 ? "NOT_FOUND" : "M2_REJECTED", msg);
      }
      return res.json();
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      throw new AppError(502, "M2_UNREACHABLE", `M2 不可达：${e?.message ?? e}`);
    } finally { clearTimeout(timer); }
  };
  /** auto 模式下只有“不可达/超时”才退回假数据；M2 明确拒绝（4xx）照常返回 */
  const unreachable = (e: any) => e instanceof AppError && (e.status === 502 || e.status === 503);
  const mock = ctx.db.t(OWN.mockReview);
  r.get("/review-queue", async (req: Req) => {
    const mode = (await runtime(ctx)).m2Mock;
    if (mode !== "on") try { return { source: "m2", items: await callM2(req, ENDPOINTS.m2ReviewQueue + (req.query?.status ? `?status=${encodeURIComponent(req.query.status)}` : "")) }; } catch (e) { if (mode === "off" || !unreachable(e)) throw e; }
    const status = String(req.query?.status ?? "pending");
    const rows = await ctx.db.query<any>(`SELECT * FROM ${mock} WHERE ($1 = 'all' OR status = $1) ORDER BY post_id`, status);
    // 与 M2 队列同形：{ postId, postUrl, postText, matchedAlias, status, candidates: [{ mentionId, projectId, name, matchedText, status }] }
    return { source: "mock", items: rows.map((x) => ({ postId: x.post_id, postUrl: x.post_url, postText: x.post_text, matchedAlias: x.matched_alias, status: x.status,
      candidates: (x.candidates ?? []).map((c: any, i: number) => ({ mentionId: x.post_id * 10 + i, matchedText: c.matchedText ?? `$${x.matched_alias}`, ...c })) })) };
  });
  // 按帖子提交：勾选的候选确认、未勾选的驳回；projectIds 为空 = 该帖全部驳回
  r.post("/review/posts/:postId", pre, async (req: Req) => {
    const id = Number(req.params.postId), mode = (await runtime(ctx)).m2Mock;
    const projectIds = parseReviewInput(req.body);
    if (!id || !projectIds) throw bad("需要 projectIds: number[]（空数组 = 整组驳回）");
    const body = buildM2ReviewBody(projectIds);
    if (mode !== "on") try {
      const out = await callM2(req, ENDPOINTS.m2ReviewPost(id), { method: "POST", body });
      await ctx.audit({ action: "review_submit", table: "post_mentions(via m2-matcher)", recordId: `post:${id}`, after: body, actorId: req.user?.id });
      return { source: "m2", result: out };
    } catch (e) { if (mode === "off" || !unreachable(e)) throw e; }
    const [cur] = await ctx.db.query<{ candidates: any[]; status: string }>(`SELECT candidates, status FROM ${mock} WHERE post_id = $1`, id);
    if (!cur || cur.status !== "pending") throw new AppError(404, "NOT_FOUND", REVIEW_404_MSG);
    const candIds = (cur.candidates ?? []).map((c: any) => Number(c.projectId));
    if (projectIds.some((p) => !candIds.includes(p))) throw bad("projectIds 里有不是该帖候选的项目");
    const candidates = (cur.candidates ?? []).map((c: any) => c.status && c.status !== "pending" ? c : ({ ...c, status: projectIds.includes(Number(c.projectId)) ? "confirmed" : "rejected" }));
    const [row] = await ctx.db.query(`UPDATE ${mock} SET status = $2, candidates = $3::jsonb, decided_project_ids = $4::int[], decided_by = $5, decided_at = now() WHERE post_id = $1 RETURNING *`,
      id, projectIds.length ? "confirmed" : "rejected", JSON.stringify(candidates), projectIds, req.user?.id ?? null);
    await ctx.audit({ action: "review_submit_mock", table: mock, recordId: id, after: row, actorId: req.user?.id });
    const d = await today(ctx);
    // 与 M2 响应同形
    return { source: "mock", result: { ok: true, postId: id, confirmed: projectIds, rejected: candIds.filter((p: number) => !projectIds.includes(p)), updated: candIds.length, dateFrom: d, dateTo: d } };
  });

  // AD-07 赛道（账号走底座接口，见前端页面）
  const trackInUse = async (id: number) => {
    const [p, b, d, c] = await Promise.all([ctx.db.core.project.count({ where: { trackId: id } }), ctx.db.core.buzzSnapshot.count({ where: { trackId: id } }),
      ctx.db.core.projectDaily.count({ where: { trackId: id } }), ctx.db.core.track.count({ where: { parentId: id } })]);
    if (p + b + d + c > 0) throw new AppError(409, "IN_USE", TRACK_IN_USE_MSG);
  };
  crud(ctx, "/tracks", "track", TABLES.tracks, ["name", "parentId"], { map: (b) => ({ ...b, parentId: b.parentId === undefined ? undefined : num(b.parentId) }), required: { name: "赛道名 name" },
    beforeDelete: trackInUse, deleteConflictMsg: TRACK_IN_USE_MSG }); // 预检 + 兜底捕获外键 Restrict
  r.get("/tracks/features", async () => ({ disable: await tracksDisableSupported(ctx) }));
  // 停用 / 启用：底座加 tracks.disabled_at 后自动可用
  for (const [act, val] of [["disable", true], ["enable", false]] as const) r.post(`/tracks/:id/${act}`, pre, async (req: Req) => {
    if (!(await tracksDisableSupported(ctx))) throw new AppError(501, "NOT_SUPPORTED", "底座还没有 tracks.disabled_at，暂不支持停用");
    const id = Number(req.params.id);
    const before = await ctx.db.core.track.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "NOT_FOUND", "赛道不存在");
    const row = await (ctx.db.core.track as any).update({ where: { id }, data: { disabledAt: val ? new Date() : null } });
    await ctx.audit({ action: `track_${act}`, table: TABLES.tracks, recordId: id, before, after: row, actorId: req.user?.id });
    return row;
  });
}
