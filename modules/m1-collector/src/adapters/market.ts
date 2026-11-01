// 只取现货计价币成交额；USD/USDT/USDC 按配置视为 1:1 美元。
import { getJson, rateLimiter, type HttpOpts } from "../http.js";
import { addDays, dayIn, dayStartMs } from "../day.js";

export interface SnapshotAt { date: string; tz: string; now?: Date; concurrency?: number }
export class SourceValues extends Map<string, number> { failures = new Map<string, string>(); }
export interface VolumeSource { exchange: string; spotVolumesUsd(symbols: string[], usdQuotes: string[], at?: SnapshotAt): Promise<SourceValues> }
export interface PriceSource { pricesUsd(ids: string[], at?: SnapshotAt): Promise<SourceValues> }
const HOUR = 3600000; const DAY = 24 * HOUR;
export function finiteAmount(v: unknown): number {
  if ((typeof v !== "string" && typeof v !== "number") || v === "") throw new Error("行情金额缺失");
  const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error("行情金额须为有限非负数"); return n;
}
export function splitPair(pair: string, quotes: string[]): [string, string] | null {
  const p = pair.replace(/[-_/]/g, "").toUpperCase();
  for (const q of [...quotes].map((x) => x.toUpperCase()).sort((a, b) => b.length - a.length)) if (p.endsWith(q) && p.length > q.length) return [p.slice(0, -q.length), q];
  return null;
}
export function sumUsd(rows: { pair: string; quoteVolume: number }[], symbols: string[], quotes: string[]): SourceValues {
  const want = new Set(symbols.map((s) => s.toUpperCase())); const out = new SourceValues();
  for (const r of rows) { const sp = splitPair(r.pair, quotes); if (sp && want.has(sp[0])) out.set(sp[0], finiteAmount((out.get(sp[0]) ?? 0) + finiteAmount(r.quoteVolume))); }
  return out;
}
export async function mapLimit<T>(values: T[], concurrency: number, fn: (v: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(values.length, Math.max(1, concurrency)) }, async () => { while (i < values.length) await fn(values[i++]); }));
}
export function bounds(at: SnapshotAt) {
  if (at.date >= dayIn(at.tz, at.now ?? new Date())) throw new Error("行情只允许完整历史日；不能把实时值写入未结束日期");
  const start = dayStartMs(at.date, at.tz); const end = dayStartMs(addDays(at.date, 1), at.tz);
  const step = start % DAY === 0 && end - start === DAY ? DAY : start % HOUR === 0 && end % HOUR === 0 ? HOUR : 60000;
  return { start, end, step };
}
interface Candle { time: number; quoteVolume: number; complete: boolean }
/** 缺一根、未收盘、重复冲突都不能伪造成完整的 24h 总量。 */
export function candleVolume(rows: Candle[], start: number, end: number, step: number): number | null {
  const seen = new Map<number, Candle>();
  for (const row of rows) if (row.time >= start && row.time < end) {
    if (seen.has(row.time) && seen.get(row.time)!.quoteVolume !== row.quoteVolume) throw new Error("行情 K 线重复且值冲突");
    seen.set(row.time, row);
  }
  if (!seen.size) return null; // 尚未上币或历史接口没有该区间
  let sum = 0;
  for (let t = start; t < end; t += step) { const row = seen.get(t); if (!row?.complete) throw new Error("行情 K 线不完整，保留缺失状态等待补抓"); sum = finiteAmount(sum + finiteAmount(row.quoteVolume)); }
  return sum;
}
function okx(r: any): any[] { if (String(r?.code) !== "0" || !Array.isArray(r.data)) throw new Error(`OKX 业务响应失败 (${r?.code ?? "invalid"})`); return r.data; }
function bybit(r: any): any { if (r?.retCode !== 0 || !r.result || typeof r.result !== "object") throw new Error(`Bybit 业务响应失败 (${r?.retCode ?? "invalid"})`); return r.result; }
interface Instrument { pair: string; base: string; quote: string }
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export function liveVolumeSources(base: { binance: string; okx: string; bybit: string }, http: HttpOpts, beforeRequest?: (source: string) => Promise<void>): Record<string, VolumeSource> {
  const limits = new Map<string, () => Promise<void>>();
  const json = (b: string, p: string, q: Record<string, string> = {}) => {
    if (!limits.has(b)) limits.set(b, rateLimiter(http.rateLimitPerMin ?? 120));
    return getJson<any>(`${b}${p}?${new URLSearchParams(q)}`, { ...http, beforeAttempt: async () => { await limits.get(b)!(); await beforeRequest?.(b); await http.beforeAttempt?.(); } });
  };
  const make = (name: string, instruments: () => Promise<Instrument[]>, candles: (pair: string, start: number, end: number, step: number) => Promise<Candle[]>, current: () => Promise<{pair: string; quoteVolume: number}[]>): VolumeSource => ({
    exchange: name,
    async spotVolumesUsd(symbols, quotes, at) {
      if (!symbols.length) return new SourceValues();
      if (!at) return sumUsd(await current(), symbols, quotes);
      const { start, end, step } = bounds(at); const want = new Set(symbols.map((v) => v.toUpperCase()));
      const rows = (await instruments()).filter((r) => want.has(r.base.toUpperCase()) && quotes.includes(r.quote.toUpperCase()));
      const out = new SourceValues();
      await mapLimit(rows, at.concurrency ?? 3, async (r) => {
        const symbol = r.base.toUpperCase();
        try {
          const vol = candleVolume(await candles(r.pair, start, end, step), start, end, step);
          if (vol == null) return;
          out.set(symbol, finiteAmount((out.get(symbol) ?? 0) + vol));
        } catch (e) { out.failures.set(symbol, errorText(e)); }
      });
      for (const symbol of out.failures.keys()) out.delete(symbol); // 部分交易对缺失不能成为该资产总量
      return out;
    }
  });
  return {
    Binance: make("Binance", async () => {
      const r = await json(base.binance, "/api/v3/exchangeInfo");
      if (!Array.isArray(r.symbols)) throw new Error("Binance 交易对响应无效");
      return r.symbols.filter((s: any) => s.isSpotTradingAllowed !== false).map((s: any) => ({ pair: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
    }, async (pair, start, end, step) => {
      const out: Candle[] = []; let cursor = start;
      while (cursor < end) {
        const r = await json(base.binance, "/api/v3/klines", { symbol: pair, interval: step === DAY ? "1d" : step === HOUR ? "1h" : "1m", startTime: String(cursor), endTime: String(end - 1), limit: "1000" });
        if (!Array.isArray(r)) throw new Error("Binance K 线响应无效"); if (!r.length) break;
        for (const row of r) out.push({ time: Number(row[0]), quoteVolume: finiteAmount(row[7]), complete: Number(row[6]) < end });
        const next = Number(r[r.length - 1][0]) + step; if (!Number.isFinite(next) || next <= cursor) throw new Error("Binance 分页未推进"); cursor = next;
      }
      return out;
    }, async () => { const r = await json(base.binance, "/api/v3/ticker/24hr"); if (!Array.isArray(r)) throw new Error("Binance 行情响应无效"); return r.map((t: any) => ({ pair: t.symbol, quoteVolume: t.quoteVolume })); }),
    OKX: make("OKX", async () => okx(await json(base.okx, "/api/v5/public/instruments", { instType: "SPOT" })).map((r) => ({ pair: r.instId, base: r.baseCcy, quote: r.quoteCcy })),
      async (pair, start, end, step) => {
        const out: Candle[] = []; let after = end;
        while (after > start) {
          const rows = okx(await json(base.okx, "/api/v5/market/history-candles", { instId: pair, bar: step === DAY ? "1Dutc" : step === HOUR ? "1H" : "1m", after: String(after), limit: "300" }));
          if (!rows.length) break;
          for (const row of rows) out.push({ time: Number(row[0]), quoteVolume: finiteAmount(row[7]), complete: row[8] === "1" });
          const next = Math.min(...rows.map((r) => Number(r[0]))); if (!Number.isFinite(next) || next >= after) throw new Error("OKX 分页未推进"); after = next;
        }
        return out;
      }, async () => okx(await json(base.okx, "/api/v5/market/tickers", { instType: "SPOT" })).map((t: any) => ({ pair: t.instId, quoteVolume: t.volCcy24h }))),
    Bybit: make("Bybit", async () => {
      const r = bybit(await json(base.bybit, "/v5/market/instruments-info", { category: "spot" }));
      if (!Array.isArray(r.list)) throw new Error("Bybit 交易对响应无效");
      return r.list.map((s: any) => ({ pair: s.symbol, base: s.baseCoin, quote: s.quoteCoin }));
    }, async (pair, start, end, step) => {
      const out: Candle[] = []; let cursorEnd = end - 1;
      while (cursorEnd >= start) {
        const r = bybit(await json(base.bybit, "/v5/market/kline", { category: "spot", symbol: pair, interval: step === DAY ? "D" : step === HOUR ? "60" : "1", start: String(start), end: String(cursorEnd), limit: "1000" }));
        if (!Array.isArray(r.list)) throw new Error("Bybit K 线响应无效"); if (!r.list.length) break;
        for (const row of r.list) out.push({ time: Number(row[0]), quoteVolume: finiteAmount(row[6]), complete: Number(row[0]) + step <= end });
        const next = Math.min(...r.list.map((r: any) => Number(r[0]))) - 1; if (!Number.isFinite(next) || next >= cursorEnd) throw new Error("Bybit 分页未推进"); cursorEnd = next;
      }
      return out;
    }, async () => { const r = bybit(await json(base.bybit, "/v5/market/tickers", { category: "spot" })); if (!Array.isArray(r.list)) throw new Error("Bybit 行情响应无效"); return r.list.map((t: any) => ({ pair: t.symbol, quoteVolume: t.turnover24h })); }),
  };
}
export function livePriceSource(base: string, http: HttpOpts, apiKey?: string, keyType = "demo", batchSize = 100): PriceSource {
  const limit = rateLimiter(http.rateLimitPerMin ?? 30);
  const opts = { ...http, beforeAttempt: async () => { await limit(); await http.beforeAttempt?.(); }, headers: { ...http.headers, ...(apiKey ? { [keyType === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: apiKey } : {}) } };
  return { async pricesUsd(ids, at) {
    const out = new SourceValues(); const unique = [...new Set(ids)]; if (!unique.length) return out;
    if (!at) {
      for (let i = 0; i < unique.length; i += batchSize) {
        const chunk = unique.slice(i, i + batchSize);
        const r = await getJson<any>(`${base}/simple/price?${new URLSearchParams({ ids: chunk.join(","), vs_currencies: "usd" })}`, opts);
        if (!r || typeof r !== "object" || r.error || r.status?.error_code) throw new Error("CoinGecko 业务响应失败");
        for (const id of chunk) if (r[id]?.usd != null) out.set(id, finiteAmount(r[id].usd));
      }
      return out;
    }
    const { end } = bounds(at);
    await mapLimit(unique, at.concurrency ?? 3, async (id) => {
      try {
        let price: unknown;
        // 最近结束日的 history 尚可能未归档，改取该日末之前的历史采样，绝不使用 simple/price。
        const latestClosedDay = addDays(dayIn(at.tz, at.now ?? new Date()), -1);
        if (end % DAY === 0 && at.date !== latestClosedDay) {
          const [year, month, day] = new Date(end).toISOString().slice(0, 10).split("-");
          const r = await getJson<any>(`${base}/coins/${encodeURIComponent(id)}/history?date=${day}-${month}-${year}&localization=false`, opts);
          if (r.error || r.status?.error_code) throw new Error("CoinGecko 历史币价响应失败");
          price = r.market_data?.current_price?.usd;
        } else {
          const r = await getJson<any>(`${base}/coins/${encodeURIComponent(id)}/market_chart/range?${new URLSearchParams({ vs_currency: "usd", from: String((end - HOUR) / 1000), to: String(end / 1000) })}`, opts);
          if (!Array.isArray(r.prices)) throw new Error("CoinGecko 历史曲线响应无效");
          const near = r.prices.filter((r: any) => Number(r[0]) <= end && Number(r[0]) >= end - HOUR).sort((a: any, b: any) => Number(b[0]) - Number(a[0]))[0]; price = near?.[1];
        }
        if (price != null) out.set(id, finiteAmount(price));
        else out.failures.set(id, "CoinGecko 未提供该日币价");
      } catch (e) { out.failures.set(id, errorText(e)); }
    });
    return out;
  } };
}
export function mockVolumeSources(names: string[]): Record<string, VolumeSource> {
  return Object.fromEntries(names.map((n, i) => [n, { exchange: n, async spotVolumesUsd(s: string[]) { return new SourceValues(s.map((x) => [x.toUpperCase(), 1000000 * (i + 1) + x.length * 1000])); } }]));
}
export const mockPriceSource: PriceSource = { async pricesUsd(ids) { return new SourceValues(ids.map((id, i) => [id, 1 + i * 0.5])); } };
