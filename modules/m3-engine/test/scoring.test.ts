import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/scoring.js";
import { CONFIG, DEFAULTS } from "../src/config.js";
import type { MentionInput, TierSet } from "../src/scoring.js";

const P2 = { version: "v2", a: 0.002, b: 0.02 };
const T1: TierSet = { version: "t1", weights: { S: 3, A: 1 } }, T2: TierSet = { version: "t2", weights: { S: 5, A: 2 } };
const opt = { defaultTierWeight: 1, coreTags: DEFAULTS["m3-engine.coreExposureTags"], fullScore: true };
const m = (o: Partial<MentionInput>): MentionInput => ({ postId: 1, projectId: 1, day: "2026-10-25", views: 1000, bookmarks: 10, status: "confirmed", inPool: true, tier: "S", tags: [], ...o });

test("公式无衰减：Σ w×(a·views+b·bookmarks)；配置键都带 m3-engine. 前缀", () => {
  assert.ok(CONFIG.every((c) => c.key.startsWith("m3-engine.")) && !CONFIG.some((c) => /decay/i.test(c.key)));
  const s = S.scoreDay(1, "2026-10-25", [m({}), m({ postId: 2, tier: "X" })], P2, T2, opt)!;
  assert.ok(Math.abs(s.rawTotal - (5 * 2.2 + 1 * 2.2)) < 1e-9);
});
test("无数据不写行；缺一项为 null；成交额求和", () => {
  assert.equal(S.scoreDay(1, "2026-10-25", [], P2, null, opt), null);
  assert.equal(S.dailyRow(undefined, null), null);
  assert.deepEqual(S.dailyRow(100, undefined), { totalSpotVolumeUsd: 100, priceUsd: null });
  assert.equal(S.sumVolume([null, null]), null);
  assert.equal(S.sumVolume([1, null, 2]), 3);
});
test("版本留痕 + 重算计划", () => {
  const s = S.scoreDay(1, "2026-10-25", [m({})], P2, T1, opt)!;
  assert.deepEqual([s.paramsVersion, s.tiersVersion], ["v2", "t1"]);
  const eff = ["2026-10-01", "2026-10-20", "2026-10-22"];
  assert.deepEqual(S.planRecalc("weights_changed", "2026-10-18", "2026-10-23", eff, "2026-10-31").map((x) => x.day), ["2026-10-22", "2026-10-23"]);
  assert.equal(S.planRecalc("manual_backfill", "2026-10-18", "2026-10-18", eff, "2026-10-31")[0].versionDay, "2026-10-31");
  assert.equal(S.planRecalc("manual_adjust", "2026-10-18", "2026-10-18", eff, "2026-10-31")[0].versionDay, "2026-10-18");
});
test("赛道：已有行沿用其 track_id（含 null），没行才用当前赛道", () => {
  assert.equal(S.pickTrack(7, 9), 7);
  assert.equal(S.pickTrack(undefined, 9), 9);
  assert.equal(S.pickTrack(null, 9), null);
  assert.equal(S.pickTrack(undefined, null), null);
});
const adj = (value: number, revoked = false) => ({ value, createdAt: "2026-10-26T01:00:00Z", revoked });
test("无赛道：照写行，不参与排名", () => {
  const row = S.buzzRow(S.scoreDay(1, "2026-10-25", [m({})], P2, T2, opt), [], undefined, null)!;
  assert.equal(row.trackId, null);
  const r = S.rankWithinTrack([{ projectId: 1, trackId: row.trackId, value: row.adjustedTotal }, { projectId: 2, trackId: 5, value: 1 }]);
  assert.equal(r.get(1), undefined); assert.equal(r.get(2), 1);
  assert.deepEqual(S.dailyRow(10, null), { totalSpotVolumeUsd: 10, priceUsd: null });
});
test("回补调整行：无原始数据 + 未撤销调整 → raw/子项 null，adjusted=调整值，赛道取当前", () => {
  const row = S.buzzRow(null, [adj(42)], undefined, 3)!;
  assert.deepEqual(row, { trackId: 3, kolPostCount: null, coreExposureCount: null, heatScore: null, rawTotal: null, adjustedTotal: 42, paramsVersion: null, tiersVersion: null });
  assert.equal(S.buzzRow(null, [], undefined, 3), null); // 无数据无调整 → 无行
});
test("撤销后删除回补行，并重排该赛道", () => {
  assert.equal(S.buzzRow(null, [adj(42, true)], 3, 3), null); // 已撤销且仍无原始数据 → 删除
  const before = S.rankWithinTrack([{ projectId: 1, trackId: 3, value: 42 }, { projectId: 2, trackId: 3, value: 10 }, { projectId: 4, trackId: 3, value: 10 }]);
  assert.deepEqual([1, 2, 4].map((i) => before.get(i)), [1, 2, 2]);
  const after = S.rankWithinTrack([{ projectId: 2, trackId: 3, value: 10 }, { projectId: 4, trackId: 3, value: 10 }]);
  assert.deepEqual([1, 2, 4].map((i) => after.get(i)), [undefined, 1, 1]);
});
test("回补行参与排名；已有行沿用旧赛道（含 null），新分配赛道不影响", () => {
  const backfill = S.buzzRow(null, [adj(100)], undefined, 3)!;
  const normal = S.buzzRow(S.scoreDay(2, "2026-10-25", [m({ projectId: 2 })], P2, T2, opt), [], 3, 9)!;
  assert.equal(normal.trackId, 3);
  const r = S.rankWithinTrack([{ projectId: 1, trackId: backfill.trackId, value: backfill.adjustedTotal }, { projectId: 2, trackId: normal.trackId, value: normal.adjustedTotal }]);
  assert.deepEqual([r.get(1), r.get(2)], [1, 2]);
  assert.equal(S.buzzRow(S.scoreDay(1, "2026-10-25", [m({})], P2, T2, opt), [], null, 9)!.trackId, null);
});
test("只算 confirmed 且人物池内", () => {
  const s = S.scoreDay(1, "2026-10-25", [m({}), m({ postId: 2, status: "pending" }), m({ postId: 3, status: "rejected" }), m({ postId: 4, inPool: false })], P2, null, opt)!;
  assert.equal(s.kolPostCount, 1);
});
test("一帖多项目：默认全分，开关平分；核心曝光；调分只改总分", () => {
  const ms = [m({ tags: ["top_vc"] }), m({ projectId: 2 })];
  const a = S.scoreDay(1, "2026-10-25", ms, P2, T2, opt)!, b = S.scoreDay(2, "2026-10-25", ms, P2, T2, opt)!;
  assert.equal(a.rawTotal, b.rawTotal);
  assert.ok(Math.abs(S.scoreDay(1, "2026-10-25", ms, P2, T2, { ...opt, fullScore: false })!.rawTotal - a.rawTotal / 2) < 1e-9);
  assert.deepEqual([a.coreExposureCount, b.coreExposureCount], [1, 0]);
  assert.equal(S.applyOverride(10, [{ value: 50, createdAt: "2026-10-26T01:00:00Z", revoked: false }, { value: 70, createdAt: "2026-10-26T02:00:00Z", revoked: true }]), 50);
  assert.equal(S.applyOverride(10, []), 10);
});
test("排名：分赛道竞争排名 1,1,3（用 @app/shared competitionRank），null/无赛道不排", () => {
  const r = S.rankWithinTrack([
    { projectId: 3, trackId: 1, value: 100 }, { projectId: 2, trackId: 1, value: 300 }, { projectId: 1, trackId: 1, value: 100 }, { projectId: 4, trackId: 1, value: 50 },
    { projectId: 5, trackId: 2, value: 1 }, { projectId: 6, trackId: null, value: 9 }, { projectId: 7, trackId: 1, value: null },
  ]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((i) => r.get(i)), [2, 1, 2, 4, 1, undefined, undefined]);
});

test("切日时区：UTC 与 Asia/Shanghai", () => {
  const t = new Date("2026-10-31T17:00:00Z");
  assert.equal(S.dayIn(t, "UTC"), "2026-10-31");
  assert.equal(S.dayIn(t, "Asia/Shanghai"), "2026-11-01");
  assert.equal(S.dayIn(new Date("2026-10-31T00:00:00Z"), "UTC"), new Date("2026-10-31T00:00:00Z").toISOString().slice(0, 10));
  // 帖子归日
  const raw = { postId: 1, projectId: 1, views: 1000, bookmarks: 10, status: "confirmed", inPool: true, tier: "S", tags: [] as string[] };
  for (const [tz, day] of [["UTC", "2026-10-31"], ["Asia/Shanghai", "2026-11-01"]] as const) {
    const ms = [{ ...raw, day: S.dayIn(t, tz) }];
    assert.ok(S.scoreDay(1, day, ms, P2, T2, opt));
    assert.equal(S.scoreDay(1, S.addDays(day, -1), ms, P2, T2, opt), null);
  }
  // 日批日期 = 切日时区今天 - lag
  assert.equal(S.defaultBatchDay(t, "UTC", 1), "2026-10-30");
  assert.equal(S.defaultBatchDay(t, "Asia/Shanghai", 1), "2026-10-31");
  // 重算上限 = 切日时区今天
  const eff = ["2026-10-01"];
  assert.deepEqual(S.planRecalc("manual_adjust", "2026-10-31", "2026-11-05", eff, S.dayIn(t, "UTC")).map((x) => x.day), ["2026-10-31"]);
  assert.deepEqual(S.planRecalc("manual_adjust", "2026-10-31", "2026-11-05", eff, S.dayIn(t, "Asia/Shanghai")).map((x) => x.day), ["2026-10-31", "2026-11-01"]);
});
