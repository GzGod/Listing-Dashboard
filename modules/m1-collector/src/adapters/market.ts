// 行情适配器：交易所现货 24h 成交额（只算美元计价交易对）+ CoinGecko 美元币价。live = 公开 REST；mock = 离线假数据。
import { getJson, type HttpOpts } from "../http.js";

export interface VolumeSource { exchange: string; spotVolumesUsd(symbols: string[], usdQuotes: string[]): Promise<Map<string, number>> }
export interface PriceSource { pricesUsd(coingeckoIds: string[]): Promise<Map<string, number>> }

/** 把 BASEQUOTE 拆开：按配置的美元计价币后缀匹配 */
export function splitPair(pair: string, quotes: string[]): [string, string] | null {
  const p = pair.replace(/[-_/]/g, "").toUpperCase();
  for (const q of [...quotes].sort((a, b) => b.length - a.length)) if (p.endsWith(q) && p.length > q.length) return [p.slice(0, -q.length), q];
  return null;
}
/** quoteVolume 已经是计价币数量；USD/USDT/USDC 视为 1:1 美元 */
export function sumUsd(rows: { pair: string; quoteVolume: number }[], symbols: string[], quotes: string[]) {
  const want = new Set(symbols.map((s) => s.toUpperCase())); const out = new Map<string, number>();
  for (const r of rows) { const sp = splitPair(r.pair, quotes); if (sp && want.has(sp[0])) out.set(sp[0], (out.get(sp[0]) ?? 0) + (Number(r.quoteVolume) || 0)); }
  return out;
}

export function liveVolumeSources(base: { binance: string; okx: string; bybit: string }, http: HttpOpts): Record<string, VolumeSource> {
  return {
    Binance: { exchange: "Binance", async spotVolumesUsd(s, q) {
      const r = await getJson<any[]>(`${base.binance}/api/v3/ticker/24hr`, http);
      return sumUsd(r.map((t) => ({ pair: t.symbol, quoteVolume: +t.quoteVolume })), s, q); } },
    OKX: { exchange: "OKX", async spotVolumesUsd(s, q) {
      const r = await getJson<any>(`${base.okx}/api/v5/market/tickers?instType=SPOT`, http);
      return sumUsd((r.data ?? []).map((t: any) => ({ pair: t.instId, quoteVolume: +t.volCcy24h })), s, q); } },
    Bybit: { exchange: "Bybit", async spotVolumesUsd(s, q) {
      const r = await getJson<any>(`${base.bybit}/v5/market/tickers?category=spot`, http);
      return sumUsd((r.result?.list ?? []).map((t: any) => ({ pair: t.symbol, quoteVolume: +t.turnover24h })), s, q); } },
  };
}
export function livePriceSource(base: string, http: HttpOpts, apiKey?: string): PriceSource {
  return { async pricesUsd(ids) {
    const out = new Map<string, number>(); if (!ids.length) return out;
    const r = await getJson<any>(`${base}/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=usd`, { ...http, headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined });
    for (const id of ids) if (r[id]?.usd != null) out.set(id, r[id].usd);
    return out; } };
}
export function mockVolumeSources(names: string[]): Record<string, VolumeSource> {
  return Object.fromEntries(names.map((n, i) => [n, { exchange: n, async spotVolumesUsd(s: string[]) { return new Map(s.map((x) => [x.toUpperCase(), 1_000_000 * (i + 1) + x.length * 1000])); } }]));
}
export const mockPriceSource: PriceSource = { async pricesUsd(ids) { return new Map(ids.map((id, i) => [id, 1 + i * 0.5])); } };
