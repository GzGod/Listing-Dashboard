// pnpm test:shared —— @app/shared 工具函数单测
import { competitionRank, FundamentalsSchema, TeamSchema, m5m6, isValidDay } from "@app/shared";
let bad = 0;
const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`${ok ? "✅" : "❌"} ${n}: ${JSON.stringify(a)}`); };
const items = [{ id: 3, s: 10 }, { id: 1, s: 10 }, { id: 2, s: 8 }, { id: 4, s: null }, { id: 5, s: 20 }, { id: 6, s: 8 }];
const r = competitionRank(items, (x) => x.s, (x) => x.id);
eq("名次 20,10,10,8,8 -> 1,2,2,4,4", r.map((x) => x.rank), [1, 2, 2, 4, 4]);
eq("同分按 id 升序", r.map((x) => x.item.id), [5, 1, 3, 2, 6]);
eq("null 分不参与排名", r.some((x) => x.item.id === 4), false);
eq("1,1,3 规则", competitionRank([{ id: 1, s: 5 }, { id: 2, s: 5 }, { id: 3, s: 1 }], (x) => x.s, (x) => x.id).map((x) => x.rank), [1, 1, 3]);
eq("空数组", competitionRank([], () => 1, () => 1), []);
eq("fundamentals 校验 capTable", FundamentalsSchema.safeParse({ capTable: [{ holder: "VC", pct: 10 }], extra: 1 }).success, true);
eq("fundamentals 拒绝坏 capTable", FundamentalsSchema.safeParse({ capTable: [{ holder: "VC" }] }).success, false);
eq("team 校验", TeamSchema.safeParse([{ name: "A", role: "CEO", url: "https://x.com/a" }]).success, true);
eq("M5M6 占位：rankings 查询参数工厂", m5m6.makeRankingsQuerySchema({ windows: [1, 7, 30], defaultWindow: 7 }).parse({ track: "2" }), { track: 2, window: 7 });
eq("posts 查询参数默认 limit 20", m5m6.projectPostsQuerySchema.parse({}), { limit: 20 });
eq("posts limit 超过 50 被拒", m5m6.projectPostsQuerySchema.safeParse({ limit: 51 }).success, false);
eq("posts 响应含 nextCursor", m5m6.postsResponseSchema.safeParse({ items: [], nextCursor: null }).success, true);
const rq = m5m6.makeRankingsQuerySchema({ windows: [1, 7, 30], defaultWindow: 7 });
for (const [d, ok] of [["2026-13-01", false], ["2026-02-30", false], ["2026-1-01", false], ["2026-10-31", true], ["2024-02-29", true]] as const) {
  let r: boolean | string; try { r = m5m6.isValidDay(d); } catch (e) { r = "抛异常:" + (e as Error).message; }
  eq(`isValidDay(${d})`, r, ok);
  eq(`根导出与 m5m6.isValidDay 一致 ${d}`, isValidDay(d), m5m6.isValidDay(d));
  eq(`rankings date=${d} safeParse 不抛`, rq.safeParse({ track: 1, date: d }).success, ok);
}
console.log(bad ? `${bad} 项失败` : "全部通过"); process.exit(bad ? 1 : 0);
