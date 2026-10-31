import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedRange, buildIndex, matchText, type ProjectRef } from "../src/match.js";
import { DEFAULTS } from "../src/config.js";

const P: ProjectRef[] = [
  { id: 1, name: "Harmony", symbol: "ONE", contracts: ["0x0000000000000000000000000000000000000001"], aliases: [{ alias: "ONE", kind: "ticker" }] },
  { id: 2, name: "OneFinity", symbol: "ONE", contracts: [], aliases: [] },
  { id: 3, name: "ApeCoin", symbol: "APE", contracts: ["0x4d224452801aced8b2f0aebe155379bb5d594381"], aliases: [{ alias: "Ape", kind: "name" }] },
  { id: 4, name: "Pool Party", symbol: "POOL", contracts: [], aliases: [{ alias: "PoolP", kind: "name" }] },
];
const idx = buildIndex(P); const S = DEFAULTS;

test("重名 ticker → pending，带全部候选", () => {
  const r = matchText("Loving $ONE today", idx, S);
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.pending.length, 1);
  assert.deepEqual(r.pending[0].candidates.map((c) => c.projectId).sort(), [1, 2]);
});
test("唯一 cashtag → 确认", () => {
  const r = matchText("$APE season", idx, S);
  assert.deepEqual(r.confirmed.map((h) => [h.projectId, h.method]), [[3, "ticker"]]);
});
test("别名匹配（名称别名）", () => {
  const r = matchText("poolp is pumping", idx, S);
  assert.deepEqual(r.confirmed.map((h) => [h.projectId, h.method]), [[4, "name"]]);
});
test("合约地址匹配，大小写不敏感", () => {
  const r = matchText("ca: 0x4D224452801ACED8B2F0AEBE155379BB5D594381", idx, S);
  assert.deepEqual(r.confirmed.map((h) => [h.projectId, h.method]), [[3, "contract"]]);
});
test("合约地址能消歧重名 ticker", () => {
  const r = matchText("$ONE 0x0000000000000000000000000000000000000001", idx, S);
  assert.deepEqual(r.confirmed.map((h) => h.projectId), [1]);
  assert.equal(r.pending.length, 0);
});
test("裸 ticker 低置信 → pending", () => {
  const r = matchText("POOL looks fine", idx, S);
  assert.equal(r.confirmed.length, 0);
  assert.deepEqual(r.pending[0].candidates.map((c) => c.projectId), [4]);
});
test("阈值可配置：调低后裸 ticker 自动确认", () => {
  const r = matchText("POOL looks fine", idx, { ...S, autoConfirmThreshold: 0.4 });
  assert.deepEqual(r.confirmed.map((h) => h.projectId), [4]);
});
test("不相关文本不匹配；单词内部不误匹配", () => {
  const r = matchText("grapefruit shapes onerous", idx, S);
  assert.equal(r.confirmed.length + r.pending.length, 0);
});
test("影响日期 = 发帖日 ~ +7 天（过去的帖子）", () => {
  assert.deepEqual(affectedRange(new Date("2026-10-01T05:00:00Z"), 7, "UTC", new Date("2026-10-31T00:00:00Z")), { dateFrom: "2026-10-01", dateTo: "2026-10-08" });
});
test("dateTo 不超过今天（截到今天）", () => {
  assert.deepEqual(affectedRange(new Date("2026-10-28T05:00:00Z"), 7, "UTC", new Date("2026-10-31T09:00:00Z")), { dateFrom: "2026-10-28", dateTo: "2026-10-31" });
});
test("按北京时间切日：UTC 16:30 已是北京次日", () => {
  assert.deepEqual(affectedRange(new Date("2026-10-28T16:30:00Z"), 7, "Asia/Shanghai", new Date("2026-10-30T17:00:00Z")), { dateFrom: "2026-10-29", dateTo: "2026-10-31" });
});
