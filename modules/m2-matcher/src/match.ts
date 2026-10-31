// 纯函数匹配逻辑（无 IO，便于单测）
export interface ProjectRef { id: number; name: string; symbol: string; contracts: string[]; aliases: { alias: string; kind: string }[] }
export type Method = "contract" | "ticker" | "name";
export interface Hit { projectId: number; method: Method; confidence: number; term: string }
export interface MatchResult { confirmed: Hit[]; pending: { term: string; method: Method; candidates: Hit[] }[] }
export interface Scores { scoreContract: number; scoreCashtag: number; scoreName: number; scoreBareTicker: number; autoConfirmThreshold: number; minTickerLength: number }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function buildIndex(projects: ProjectRef[]) {
  const tickers = new Map<string, Set<number>>(), names = new Map<string, Set<number>>(), contracts = new Map<string, Set<number>>();
  const add = (m: Map<string, Set<number>>, k: string, id: number) => { if (k) m.set(k, (m.get(k) ?? new Set()).add(id)); };
  for (const p of projects) {
    add(tickers, p.symbol.toUpperCase(), p.id); add(names, p.name.toLowerCase(), p.id);
    for (const c of p.contracts) add(contracts, c.toLowerCase(), p.id);
    for (const a of p.aliases) {
      if (a.kind === "ticker") add(tickers, a.alias.replace(/^\$/, "").toUpperCase(), p.id);
      else if (a.kind === "contract") add(contracts, a.alias.toLowerCase(), p.id);
      else add(names, a.alias.toLowerCase(), p.id);
    }
  }
  return { tickers, names, contracts };
}
export type Index = ReturnType<typeof buildIndex>;

export function matchText(text: string, idx: Index, s: Scores): MatchResult {
  const groups: { term: string; method: Method; ids: Set<number>; conf: number }[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/0x[a-f0-9]{40}|[1-9a-hj-np-z]{32,44}/gi)) {
    const ids = idx.contracts.get(m[0].toLowerCase()); if (ids) groups.push({ term: m[0], method: "contract", ids, conf: s.scoreContract });
  }
  const seenTicker = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9]{0,14})\b/g)) {
    const t = m[1].toUpperCase(); const ids = idx.tickers.get(t);
    if (ids && !seenTicker.has(t)) { seenTicker.add(t); groups.push({ term: "$" + t, method: "ticker", ids, conf: s.scoreCashtag }); }
  }
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,14})\b/g)) {
    const t = m[1]; if (t.length < s.minTickerLength || seenTicker.has(t)) continue;
    const ids = idx.tickers.get(t); if (ids) { seenTicker.add(t); groups.push({ term: t, method: "ticker", ids, conf: s.scoreBareTicker }); }
  }
  for (const [n, ids] of idx.names) if (n.length >= s.minTickerLength && new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`).test(lower))
    groups.push({ term: n, method: "name", ids, conf: s.scoreName });

  // 每个项目取最高置信度的确定命中；一个词对应多个项目（重名 ticker）→ 待确认
  const best = new Map<number, Hit>(); const amb: MatchResult["pending"] = [];
  for (const g of groups) {
    const hits = [...g.ids].map((projectId) => ({ projectId, method: g.method, confidence: g.conf, term: g.term }));
    if (hits.length === 1) { const h = hits[0]; if ((best.get(h.projectId)?.confidence ?? -1) < h.confidence) best.set(h.projectId, h); }
    else amb.push({ term: g.term, method: g.method, candidates: hits });
  }
  const confirmed: Hit[] = [], pending: MatchResult["pending"] = [];
  for (const h of best.values()) {
    if (h.confidence >= s.autoConfirmThreshold) confirmed.push(h);
    else pending.push({ term: h.term, method: h.method, candidates: [h] });
  }
  const sure = new Set(confirmed.map((h) => h.projectId));
  // 重名词：如果其中某个候选已被别的强证据确认，就不再进队列
  for (const a of amb) if (!a.candidates.some((c) => sure.has(c.projectId))) pending.push(a);
  return { confirmed, pending };
}

/** 帖子里实际命中某项目的文本（读时重新推导，不存库）：只用该项目建索引再匹配一次 */
export function matchedTerm(text: string, project: ProjectRef, s: Scores): string | null {
  const r = matchText(text, buildIndex([project]), { ...s, autoConfirmThreshold: 0 });
  const h = [...r.confirmed, ...r.pending.flatMap((g) => g.candidates)].sort((a, b) => b.confidence - a.confidence)[0];
  return h ? h.term : null;
}

/** 某时刻在切日时区（time.dayCutTimezone）下的日期 YYYY-MM-DD */
export function dayIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
/** post 影响的日期：发帖日 ~ 发帖日+refetchDays，dateTo 不超过今天（都按切日时区） */
export function affectedRange(postedAt: Date, refetchDays: number, tz = "UTC", now = new Date()) {
  const f = dayIn(tz, postedAt); const today = dayIn(tz, now);
  const to = new Date(Date.parse(f + "T00:00:00Z") + refetchDays * 864e5).toISOString().slice(0, 10);
  return { dateFrom: f, dateTo: to > today ? today : to };
}
