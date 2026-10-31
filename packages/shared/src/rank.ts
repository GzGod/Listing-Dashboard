/**
 * 竞赛排名（standard competition ranking，"1224" 规则）：
 * 按 score 降序；同分按 id 升序排先后（只影响列表顺序，不影响名次）；同分同名次，下一名跳号：1,1,3。
 * score 为 null/undefined/NaN 的项目不参与排名（调用方自行放进"暂无数据"）。
 */
export function competitionRank<T>(items: readonly T[], score: (t: T) => number | null | undefined, id: (t: T) => number | string): { item: T; rank: number }[] {
  const scored = items.map((item) => ({ item, s: score(item), k: id(item) })).filter((x): x is { item: T; s: number; k: number | string } => typeof x.s === "number" && !Number.isNaN(x.s));
  scored.sort((a, b) => (b.s !== a.s ? b.s - a.s : a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const out: { item: T; rank: number }[] = [];
  scored.forEach((x, i) => out.push({ item: x.item, rank: i > 0 && x.s === scored[i - 1].s ? out[i - 1].rank : i + 1 }));
  return out;
}
