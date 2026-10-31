// status 语义测试：用内存版 ctx 跑 matchPosts / reviewQueue / resolveReview（不连库）
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPosts, resolvePost, reviewQueue } from "../src/service.js";
import { DEFAULTS } from "../src/config.js";

function fakeCtx() {
  const projects = [
    { id: 1, name: "Harmony", symbol: "ONE", contracts: [], aliases: [] },
    { id: 2, name: "OneFinity", symbol: "ONE", contracts: [], aliases: [] },
    { id: 3, name: "ApeCoin", symbol: "APE", contracts: [], aliases: [] },
    { id: 4, name: "One Labs", symbol: "ONE", contracts: [], aliases: [] },
  ];
  const posts = [{ id: 10, text: "Loving $ONE and $APE", url: "u", postedAt: new Date("2026-10-28T05:00:00Z") }];
  const hit = (m: any, w: any) => (w.id == null || (typeof w.id === "number" ? m.id === w.id : w.id.in.includes(m.id))) && (w.status == null || m.status === w.status) && (!("reviewedBy" in w) || (m.reviewedBy ?? null) === w.reviewedBy);
  const mentions: any[] = []; const emitted: any[] = []; const audits: any[] = []; let seq = 100;
  const pm = {
    findUnique: async ({ where, include }: any) => { const m = where.id != null ? mentions.find((x) => x.id === where.id) : mentions.find((x) => x.postId === where.postId_projectId.postId && x.projectId === where.postId_projectId.projectId);
      return m ? (include?.post ? { ...m, post: posts.find((p) => p.id === m.postId) } : m) : null; },
    findMany: async ({ where, include }: any) => mentions.filter((m) => (where.status == null || m.status === where.status) && (where.postId == null || m.postId === where.postId))
      .map((m) => include ? { ...m, post: posts.find((p) => p.id === m.postId), project: projects.find((p) => p.id === m.projectId) } : { ...m }),
    create: async ({ data }: any) => { const m = { id: seq++, ...data }; mentions.push(m); return m; },
    update: async ({ where, data }: any) => Object.assign(mentions.find((m) => m.id === where.id), data),
    updateMany: async ({ where, data }: any) => { const xs = mentions.filter((m) => hit(m, where)); xs.forEach((m) => Object.assign(m, data)); return { count: xs.length }; },
    deleteMany: async ({ where }: any) => { const xs = mentions.filter((m) => hit(m, where)); xs.forEach((m) => mentions.splice(mentions.indexOf(m), 1)); return { count: xs.length }; },
  };
  const ctx: any = {
    config: { get: async (k: string, d?: unknown) => (k === "posts.refetchDays" ? 7 : k === "time.dayCutTimezone" ? "Asia/Shanghai" : (d ?? (DEFAULTS as any)[k.replace("m2-matcher.", "")])) },
    db: { core: { $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops), project: { findMany: async () => projects }, post: { findMany: async () => posts }, postMention: pm } },
    events: { emit: async (e: string, p: unknown) => { emitted.push([e, p]); } },
    audit: async (a: unknown) => { audits.push(a); },
  };
  return { ctx, mentions, emitted, audits, posts, projects };
}

test("重名 ticker 每个候选一行 pending，唯一 ticker confirmed；幂等", async () => {
  const { ctx, mentions } = fakeCtx();
  await matchPosts(ctx, [10]); await matchPosts(ctx, [10]);
  assert.equal(mentions.length, 4);
  assert.deepEqual(mentions.map((m) => [m.projectId, m.status]).sort(), [[1, "pending"], [2, "pending"], [3, "confirmed"], [4, "pending"]]);
});
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const TO = "2026-11-04" > today ? today : "2026-11-04";
const others = (ms: any[]) => ms.filter((m) => m.projectId !== 3).map((m) => [m.projectId, m.status]).sort();

test("队列按帖子分组，暴露 postId 和候选列表", async () => {
  const { ctx } = fakeCtx(); await matchPosts(ctx, [10]);
  const q = await reviewQueue(ctx);
  assert.equal(q.length, 1); assert.equal(q[0].postId, 10);
  assert.deepEqual(q[0].candidates.map((c) => c.projectId).sort(), [1, 2, 4]);
});
test("多选确认：选中的 confirmed，其余 rejected（不删），一次事件覆盖全部受影响项目", async () => {
  const { ctx, mentions, emitted, audits } = fakeCtx(); await matchPosts(ctx, [10]);
  const r = await resolvePost(ctx, 10, { projectIds: [2, 4, 2] }, 7);
  assert.deepEqual(others(mentions), [[1, "rejected"], [2, "confirmed"], [4, "confirmed"]]);
  assert.equal(mentions.length, 4);
  assert.ok(mentions.filter((m) => m.projectId !== 3).every((m) => m.reviewedBy === 7 && m.reviewedAt));
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], ["recalc.requested", { reason: "mention_changed", projectIds: [2, 4, 1], dateFrom: "2026-10-28", dateTo: TO }]);
  assert.deepEqual([r.confirmed, r.rejected], [[2, 4], [1]]);
  assert.equal(audits.length, 1);
  assert.equal((await reviewQueue(ctx)).length, 0);
});
test("空数组 = 全部驳回；重复审核 404；重跑匹配不改回 pending", async () => {
  const { ctx, mentions, emitted } = fakeCtx(); await matchPosts(ctx, [10]);
  await resolvePost(ctx, 10, { projectIds: [] }, 7);
  assert.deepEqual(others(mentions), [[1, "rejected"], [2, "rejected"], [4, "rejected"]]);
  assert.deepEqual((emitted[0][1] as any).projectIds.sort(), [1, 2, 4]);
  await assert.rejects(resolvePost(ctx, 10, { projectIds: [] }), (e: any) => e.status === 404 || /没有待确认/.test(e.message));
  await matchPosts(ctx, [10]);
  assert.deepEqual(others(mentions), [[1, "rejected"], [2, "rejected"], [4, "rejected"]]);
});
test("非候选 id → 400，且不改任何行；非整数/非数组 → 400；未知帖子 → 404", async () => {
  const { ctx, mentions, emitted } = fakeCtx(); await matchPosts(ctx, [10]);
  await assert.rejects(resolvePost(ctx, 10, { projectIds: [2, 3] }), /不在该帖候选/); // 3 是已 confirmed 的 APE，不是 pending 候选
  await assert.rejects(resolvePost(ctx, 10, { projectIds: [1.5] }), /整数数组/);
  await assert.rejects(resolvePost(ctx, 10, { projectIds: "1" }), /整数数组/);
  await assert.rejects(resolvePost(ctx, 10, {}), /整数数组/);
  await assert.rejects(resolvePost(ctx, 999, { projectIds: [] }), /没有待确认/);
  assert.ok(mentions.filter((m) => m.projectId !== 3).every((m) => m.status === "pending"));
  assert.equal(emitted.length, 0);
});

test("重匹配：重算自动行，旧的自动 confirmed 不会和新 pending 并存；人工行不动", async () => {
  const { ctx, mentions, posts, projects } = fakeCtx();
  posts[0].text = "Loving $APE"; await matchPosts(ctx, [10]);
  assert.deepEqual(mentions.map((m) => [m.projectId, m.status]), [[3, "confirmed"]]);
  // 项目 3 新增重名 ticker：再匹配后 APE 变成歧义 → 只剩 pending，没有残留的自动 confirmed
  projects.push({ id: 5, name: "Ape Two", symbol: "APE", contracts: [], aliases: [] });
  await matchPosts(ctx, [10]);
  assert.deepEqual(mentions.map((m) => [m.projectId, m.status]).sort(), [[3, "pending"], [5, "pending"]]);
  // 人工审核后再匹配：人工行保持；帖子改文后不再命中的自动行被删
  await resolvePost(ctx, 10, { projectIds: [3] }, 9);
  posts[0].text = "Loving $ONE"; await matchPosts(ctx, [10]);
  const got = mentions.map((m) => [m.projectId, m.status, m.reviewedBy ?? null]).sort();
  assert.deepEqual(got, [[1, "pending", null], [2, "pending", null], [3, "confirmed", 9], [4, "pending", null], [5, "rejected", 9]]);
});
test("队列 matchedAlias / matchedText 是帖子里实际命中的别名，不是项目 symbol", async () => {
  const { ctx, posts, projects } = fakeCtx();
  projects.length = 0;
  projects.push({ id: 7, name: "Tiec Two", symbol: "TIEC2", contracts: [], aliases: [{ alias: "TIEC", kind: "ticker" }] } as any,
    { id: 8, name: "Tiecoin", symbol: "TIEC", contracts: [], aliases: [] } as any);
  posts[0].text = "buy $TIEC now"; await matchPosts(ctx, [10]);
  const [q] = await reviewQueue(ctx);
  assert.equal(q.matchedAlias, "$TIEC");
  assert.ok(q.candidates.every((c) => c.matchedText === "$TIEC"));
});
