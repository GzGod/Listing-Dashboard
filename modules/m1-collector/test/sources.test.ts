import { test } from "node:test";
import assert from "node:assert/strict";
import { bounds, candleVolume, finiteAmount, livePriceSource, liveVolumeSources } from "../src/adapters/market.js";
import { resolveAssets } from "../src/assets.js";
import { dayStartMs } from "../src/day.js";
const http = { timeoutMs: 1000, retries: 1, retryDelayMs: 0, rateLimitPerMin: 60000000 };
const at = { date: "2026-10-01", tz: "UTC", now: new Date("2026-10-31T00:00:00Z"), concurrency: 3 };
const start = Date.parse("2026-10-01T00:00:00Z"); const end = start + 86400000;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("现货金额拒绝 NaN、负数和缺失；0 是有效值", () => {
  for (const n of [null, undefined, "", -1, NaN, Infinity]) assert.throws(() => finiteAmount(n));
  assert.equal(finiteAmount("0"), 0);
});
test("完整日边界覆盖北京与夏令时，不允许当日行情回填", () => {
  assert.equal(dayStartMs("2026-10-01", "Asia/Shanghai"), start - 8 * 3600000);
  const dst = bounds({ date: "2026-11-01", tz: "America/New_York", now: new Date("2026-11-03T00:00:00Z") });
  assert.equal(dst.end - dst.start, 25 * 3600000);
  assert.throws(() => bounds({ ...at, date: "2026-10-31" }), /完整历史日/);
});
test("K 线缺失不能当零成交；真实零保留；重复冲突拒绝", () => {
  assert.equal(candleVolume([], start, end, 86400000), null);
  assert.equal(candleVolume([{ time: start, quoteVolume: 0, complete: true }], start, end, 86400000), 0);
  assert.throws(() => candleVolume([{ time: start, quoteVolume: 1, complete: false }], start, end, 86400000));
  assert.throws(() => candleVolume([{ time: start, quoteVolume: 1, complete: true }], start, end, 3600000));
  assert.throws(() => candleVolume([{ time: start, quoteVolume: 1, complete: true }, { time: start, quoteVolume: 2, complete: true }], start, end, 86400000));
});
test("三家交易所历史行情均读取指定日的 quote turnover，OKX 用 UTC 日线", async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (u: string) => {
    const url = new URL(u); urls.push(url);
    if (url.pathname.endsWith("exchangeInfo")) return response({ symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }] });
    if (url.pathname.endsWith("klines")) return response([[start, 1, 2, 3, 4, "999", end - 1, "100"]]);
    if (url.pathname.endsWith("instruments")) return response({ code: "0", data: [{ instId: "BTC-USDT", baseCcy: "BTC", quoteCcy: "USDT" }] });
    if (url.pathname.endsWith("history-candles")) return response({ code: "0", data: [[String(start), "1", "2", "3", "4", "999", "999", "200", "1"]] });
    if (url.pathname.endsWith("instruments-info")) return response({ retCode: 0, result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT" }] } });
    if (url.pathname.endsWith("kline")) return response({ retCode: 0, result: { list: [[String(start), "1", "2", "3", "4", "999", "300"]] } });
    throw new Error("意外调用实时行情");
  });
  const sources = liveVolumeSources({ binance: "https://binance.test", okx: "https://okx.test", bybit: "https://bybit.test" }, http);
  assert.equal((await sources.Binance.spotVolumesUsd(["BTC"], ["USDT"], at)).get("BTC"), 100);
  assert.equal((await sources.OKX.spotVolumesUsd(["BTC"], ["USDT"], at)).get("BTC"), 200);
  assert.equal((await sources.Bybit.spotVolumesUsd(["BTC"], ["USDT"], at)).get("BTC"), 300);
  assert.equal(urls.find((u) => u.pathname.endsWith("history-candles"))!.searchParams.get("bar"), "1Dutc");
  assert.equal(urls.find((u) => u.pathname.endsWith("klines"))!.searchParams.get("startTime"), String(start));
});
test("交易所 HTTP 200 的业务错误不得作为成功空行情", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response({ code: "50011", data: [], retCode: 10006, result: { list: [] } }));
  const sources = liveVolumeSources({ binance: "https://binance.test", okx: "https://okx.test", bybit: "https://bybit.test" }, http);
  await assert.rejects(sources.OKX.spotVolumesUsd(["BTC"], ["USDT"]), /业务响应失败/);
  await assert.rejects(sources.Bybit.spotVolumesUsd(["BTC"], ["USDT"]), /业务响应失败/);
});
test("CoinGecko 查询日末历史价格、按 ID 隔离失败、支持 pro 密钥", async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (u: string, init: RequestInit) => {
    const url = new URL(u); urls.push(url); assert.equal((init.headers as Record<string, string>)["x-cg-pro-api-key"], "secret");
    return url.pathname.includes("invalid") ? response({}, 404) : response({ market_data: { current_price: { usd: 99 } } });
  });
  const result = await livePriceSource("https://cg.test", http, "secret", "pro").pricesUsd(["bitcoin", "invalid"], at);
  assert.equal(result.get("bitcoin"), 99); assert.ok(result.failures.has("invalid"));
  assert.ok(urls.every((u) => u.pathname.endsWith("history") && u.searchParams.get("date") === "02-10-2026"));
});
test("实时币价按去重 ID 分批，不以 symbol 串项目", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (u: string) => { calls++; return response(Object.fromEntries(new URL(u).searchParams.get("ids")!.split(",").map((id) => [id, { usd: 1 }]))); });
  const result = await livePriceSource("https://cg.test", http, undefined, "demo", 2).pricesUsd(["a", "b", "c", "a"]);
  assert.equal(calls, 2); assert.equal(result.size, 3);
});
test("同名 ticker 不能复制成交量；显式交易所映射可消歧", () => {
  const projects = [{ id: 1, symbol: "ONE" }, { id: 2, symbol: "ONE" }, { id: 3, symbol: "BTC" }];
  assert.deepEqual(resolveAssets(projects, [], 1).blocked, [1, 2]);
  const result = resolveAssets(projects, [{ project_id: 1, exchange_id: 1, base_symbol: "ONE", note: "verified" }], 1);
  assert.equal(result.chosen.get(1), "ONE"); assert.deepEqual(result.blocked, [2]);
  assert.equal(resolveAssets(projects, [{ project_id: 1, exchange_id: 1, base_symbol: "BTC", note: "wrong" }], 1).chosen.size, 0);
});

test("最近完整日使用历史曲线的日末采样，不等待未归档 history 或改取实时价", async (t) => {
  let called = false;
  t.mock.method(globalThis, "fetch", async (u: string) => {
    const url = new URL(u); assert.ok(url.pathname.endsWith("market_chart/range")); called = true;
    return response({ prices: [[end - 1000, 99], [end + 1000, 1000]] });
  });
  const result = await livePriceSource("https://cg.test", http).pricesUsd(["bitcoin"], { ...at, now: new Date("2026-10-02T01:10:00Z") });
  assert.equal(result.get("bitcoin"), 99); assert.ok(called);
});
