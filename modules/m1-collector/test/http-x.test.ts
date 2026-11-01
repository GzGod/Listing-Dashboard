import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson, HttpError, retryAfterMs } from "../src/http.js";
import { XApiSource, parseXMetrics } from "../src/adapters/x.js";
const opts = { timeoutMs: 1000, retries: 3, retryDelayMs: 0, rateLimitPerMin: 60000000 };
const response = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(data), { status, headers });

test("HTTP 重试逐次计费，业务 4xx 不重试，错误中不泄漏查询凭据", async (t) => {
  let calls = 0, budget = 0;
  t.mock.method(globalThis, "fetch", async () => response({ ok: true }, ++calls < 3 ? 503 : 200));
  assert.deepEqual(await getJson("https://example.test/path?token=secret", { ...opts, beforeAttempt: async () => { budget++; } }), { ok: true });
  assert.equal(calls, 3); assert.equal(budget, 3);
  t.mock.method(globalThis, "fetch", async () => { calls++; return response({}, 401); });
  await assert.rejects(getJson("https://example.test/path?token=secret", opts), (e: any) => e.status === 401 && !e.message.includes("secret"));
  assert.equal(calls, 4);
});
test("429 尊重长 Retry-After，最终失败不额外等待", async (t) => {
  assert.equal(retryAfterMs(new Headers({ "retry-after": "2" })), 2000);
  assert.equal(retryAfterMs(new Headers({ "retry-after": "Thu, 01 Oct 2026 00:01:00 GMT" }), Date.parse("2026-10-01T00:00:00Z")), 60000);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return response({}, 429, { "retry-after": "120" }); });
  await assert.rejects(getJson("https://example.test", { ...opts, maxRetryDelayMs: 1000 }), HttpError); assert.equal(calls, 1);
  const before = Date.now();
  await assert.rejects(getJson("https://example.test", { ...opts, retries: 1, retryDelayMs: 1000 }));
  assert.ok(Date.now() - before < 500);
});
test("指标缺失与无效数保留 null，明确的 0 保留 0", () => {
  assert.deepEqual(parseXMetrics({ id: "1", public_metrics: { impression_count: 0 } }), { id: "1", views: 0, bookmarks: null });
  assert.deepEqual(parseXMetrics({ id: "1", public_metrics: { impression_count: -1, bookmark_count: Infinity } }), { id: "1", views: null, bookmarks: null });
  assert.throws(() => parseXMetrics({ id: "fake" }));
});
test("X 分页令牌与 since_id 保留完整增量，身份缓存不重复查用户", async (t) => {
  const urls: URL[] = []; let charged = 0;
  t.mock.method(globalThis, "fetch", async (u: string) => {
    const url = new URL(u); urls.push(url);
    if (url.pathname.includes("by/username")) return response({ data: { id: "123" } });
    const second = url.searchParams.get("pagination_token") === "next";
    return response({ data: [{ id: second ? "11" : "12", text: "$BTC", created_at: "2026-10-01T00:00:00Z", public_metrics: { impression_count: 10 } }], meta: second ? { newest_id: "11" } : { newest_id: "12", next_token: "next" } });
  });
  const source = new XApiSource("https://example.test/2", "token", opts, 60000000, { left: 10, consume: async () => { charged++; } });
  const first = await source.userTimelinePage("@Alice", { sinceId: "10", max: 20 });
  const second = await source.userTimelinePage("Alice", { sinceId: "10", nextToken: first.nextToken, max: 20 });
  assert.deepEqual([...first.posts, ...second.posts].map((p) => p.id), ["12", "11"]);
  assert.ok(urls.slice(1).every((u) => u.searchParams.get("since_id") === "10")); assert.equal(charged, 3);
  assert.equal(first.posts[0].bookmarks, null);
});
test("X HTTP 重试也消耗预算，预算耗尽不会请求网络", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return response({}, 503); });
  const source = new XApiSource("https://example.test", "token", opts, 60000000, { left: 2 });
  await assert.rejects(source.lookup(["1"]), /调用上限/); assert.equal(calls, 2);
});

test("复制示例环境文件的空配置不覆盖安全默认值", async (t) => {
  const { ConfigCenter } = await import("@app/core");
  const { CONFIG_SPEC } = await import("../src/config.js");
  const center = new ConfigCenter({ systemConfig: { findUnique: async () => null } } as any);
  center.addModuleDefaults(CONFIG_SPEC);
  const key = "CONFIG_M1_COLLECTOR_X_SOURCE"; const prior = process.env[key]; process.env[key] = " ";
  t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  assert.equal(await center.get("m1-collector.xSource"), "disabled");
});
