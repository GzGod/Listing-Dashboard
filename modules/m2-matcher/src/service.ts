import type { ModuleContext } from "@app/core";
import { AppError } from "@app/core";
import { affectedRange, buildIndex, matchText, matchedTerm, type ProjectRef } from "./match.js";
import { loadConfig } from "./config.js";

export const STATUS = { pending: "pending", confirmed: "confirmed", rejected: "rejected" } as const;

export async function loadProjects(ctx: ModuleContext): Promise<ProjectRef[]> {
  const ps = await ctx.db.core.project.findMany({ include: { contracts: true, aliases: true } });
  return ps.map((p) => ({ id: p.id, name: p.name, symbol: p.symbol, contracts: p.contracts.map((c) => c.address), aliases: p.aliases.map((a) => ({ alias: a.alias, kind: a.kind })) }));
}

/** post.ingested / rematch：每个帖子在一个事务里重算全部"自动行"（reviewed_by 为空）。
 *  人工审核过的行（reviewed_by 有值）一律不动；不再命中的自动行删除（它们是机器产物，从未被人看过）。幂等。 */
export async function matchPosts(ctx: ModuleContext, postIds: number[]) {
  const c = await loadConfig(ctx); const idx = buildIndex(await loadProjects(ctx));
  const posts = await ctx.db.core.post.findMany({ where: { id: { in: postIds } } });
  let confirmed = 0, pending = 0;
  const changedDays = new Set<string>();
  for (const post of posts) {
    const r = matchText(post.text ?? "", idx, c);
    const want = new Map<number, { status: string; method: string }>();
    for (const g of r.pending) for (const h of g.candidates) want.set(h.projectId, { status: STATUS.pending, method: h.method });
    for (const h of r.confirmed) want.set(h.projectId, { status: STATUS.confirmed, method: h.method });
    const existing = await ctx.db.core.postMention.findMany({ where: { postId: post.id } });
    const human = new Set(existing.filter((m) => m.reviewedBy != null || m.reviewedAt != null).map((m) => m.projectId));
    const auto = existing.filter((m) => m.reviewedBy == null && m.reviewedAt == null);
    const ops: any[] = [];
    const stale = auto.filter((m) => !want.has(m.projectId)).map((m) => m.id);
    if (stale.length) ops.push(ctx.db.core.postMention.deleteMany({ where: { id: { in: stale }, reviewedBy: null } }));
    for (const [projectId, w] of want) {
      if (human.has(projectId)) continue;
      const ex = auto.find((m) => m.projectId === projectId);
      if (ex) { if (ex.status !== w.status || ex.matchMethod !== w.method) ops.push(ctx.db.core.postMention.updateMany({ where: { id: ex.id, reviewedBy: null }, data: { status: w.status, matchMethod: w.method } })); }
      else ops.push(ctx.db.core.postMention.create({ data: { postId: post.id, projectId, matchMethod: w.method, status: w.status } }));
      if (w.status === STATUS.confirmed) confirmed++; else pending++;
    }
    if (ops.length) {
      await ctx.db.core.$transaction(ops);
    }
    // 事件投递失败后的重试也必须触发日批，即使 mention 行已在上次写完。
    // 加入完整回抓窗口（dateFrom ~ dateTo），不能只加发帖日，否则回抓窗口内的后续日不会重算。
    const range = affectedRange(post.postedAt, c.refetchDays, c.tz);
    changedDays.add(range.dateFrom);
    changedDays.add(range.dateTo);
  }
  if (changedDays.size) {
    const dates = [...changedDays].sort();
    await ctx.events.emit("recalc.requested", { reason: "mention_changed", dateFrom: dates[0], dateTo: dates[dates.length - 1] });
  }
  return { posts: posts.length, confirmed, pending };
}

/** 确认队列：按帖子分组（一个帖子的全部 pending 候选为一组） */
export async function reviewQueue(ctx: ModuleContext, limit?: number) {
  const c = await loadConfig(ctx);
  const rows = await ctx.db.core.postMention.findMany({ where: { status: STATUS.pending }, include: { post: true, project: { include: { contracts: true, aliases: true } } }, orderBy: { id: "asc" } });
  const term = (m: (typeof rows)[number]) => matchedTerm(m.post.text ?? "", { id: m.project.id, name: m.project.name, symbol: m.project.symbol,
    contracts: m.project.contracts.map((x) => x.address), aliases: m.project.aliases.map((a) => ({ alias: a.alias, kind: a.kind })) }, c);
  const groups = new Map<number, typeof rows>();
  for (const r of rows) groups.set(r.postId, [...(groups.get(r.postId) ?? []), r]);
  return [...groups.values()].slice(0, limit ?? c.reviewPageSize).map((g) => ({
    postId: g[0].postId, postUrl: g[0].post.url, postText: g[0].post.text, postedAt: g[0].post.postedAt,
    matchedAlias: term(g[0]), method: g[0].matchMethod,
    candidates: g.map((m) => ({ mentionId: m.id, projectId: m.projectId, name: m.project.name, symbol: m.project.symbol, method: m.matchMethod, matchedText: term(m) })),
  }));
}

/** 按帖子审核：projectIds 里的 pending 候选 → confirmed，其余 pending 候选 → rejected；[] = 全部驳回。一个事务，不删行。 */
export async function resolvePost(ctx: ModuleContext, postId: number, body: { projectIds?: unknown }, actorId?: number | null) {
  const raw = body?.projectIds;
  if (!Array.isArray(raw) || !raw.every((x) => Number.isInteger(x))) throw new AppError(400, "BAD_INPUT", "projectIds 必须是整数数组（[] = 全部驳回）");
  const pick = [...new Set(raw as number[])];
  const c = await loadConfig(ctx);
  const group = await ctx.db.core.postMention.findMany({ where: { postId, status: STATUS.pending }, include: { post: true } });
  if (!group.length) throw new AppError(404, "NOT_FOUND", `帖子 ${postId} 没有待确认的候选`);
  const cand = new Set(group.map((x) => x.projectId));
  const bad = pick.filter((id) => !cand.has(id));
  if (bad.length) throw new AppError(400, "BAD_INPUT", `projectIds 不在该帖候选里：${bad.join(",")}`);
  const now = new Date(); const by = actorId ?? null;
  const confirmIds = group.filter((x) => pick.includes(x.projectId)).map((x) => x.id);
  const rejectIds = group.filter((x) => !pick.includes(x.projectId)).map((x) => x.id);
  // 只改仍是 pending 的行，防并发重复审核
  const [conf, rej] = await ctx.db.core.$transaction([
    ctx.db.core.postMention.updateMany({ where: { id: { in: confirmIds }, status: STATUS.pending }, data: { status: STATUS.confirmed, reviewedBy: by, reviewedAt: now } }),
    ctx.db.core.postMention.updateMany({ where: { id: { in: rejectIds }, status: STATUS.pending }, data: { status: STATUS.rejected, reviewedBy: by, reviewedAt: now } }),
  ]);
  const confirmed = group.filter((x) => pick.includes(x.projectId)).map((x) => x.projectId);
  const rejected = group.filter((x) => !pick.includes(x.projectId)).map((x) => x.projectId);
  await ctx.audit({ action: "review", table: "post_mentions", recordId: postId,
    before: group.map((x) => ({ id: x.id, projectId: x.projectId, status: x.status })), after: { confirmed, rejected }, actorId: by });
  const range = affectedRange(group[0].post.postedAt, c.refetchDays, c.tz);
  const projectIds = [...confirmed, ...rejected];
  await ctx.events.emit("recalc.requested", { reason: "mention_changed", projectIds, ...range });
  return { ok: true, postId, confirmed, rejected, updated: conf.count + rej.count, ...range };
}
