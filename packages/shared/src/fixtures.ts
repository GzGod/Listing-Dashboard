// 前台接口假数据：M5/M6 在后端实现之前，直接用这些数据开发页面。格式与 api.ts 完全一致。
import type { CalendarResponse, ProjectResponse } from "./api.js";
import type { MarketSnapshotIngestedEvent, PostIngestedEvent, RecalcRequestedEvent } from "./events.js";
const item = { listingId: 1, day: "2026-10-28", stage: "spot" as const, pair: "ALPHA/USDT", announcementUrl: "https://example.com/a",
  exchange: { id: 1, name: "Binance" }, project: { id: 1, name: "Alpha Agent", symbol: "ALPHA", trackId: 2 } };
export const fakeCalendar: CalendarResponse = { from: "2026-10-25", to: "2026-10-31", items: [item] };
export const fakeProject: ProjectResponse = {
  project: { id: 1, name: "Alpha Agent", symbol: "ALPHA", trackId: 2, fundamentals: { summary: "AI Agent 基础设施", capTable: [{ holder: "团队", pct: 20 }, { holder: "VC", pct: 15, note: "锁仓 12 个月" }] },
    team: [{ name: "Alice", role: "CEO", url: "https://x.com/alice" }], logoUrl: null, websiteUrl: "https://alpha.example", xHandle: "alpha_agent", docsUrl: null,
    usersCount: 120000, usersAsOf: "2026-10-01", usersSource: "官网", revenueUsd: "350000.00", revenuePeriod: "30d", revenueAsOf: "2026-10-01", revenueSource: "Token Terminal", longgeRating: "A", longgeRatedAt: "2026-10-11" },
  track: { id: 2, name: "AI Agent", parentId: 1 }, contracts: [{ chain: "ethereum", address: "0x0000000000000000000000000000000000000001" }], listings: [item] };
export const fakeEvents = {
  "post.ingested": { postIds: [1, 2], platform: "X", ingestedAt: "2026-10-31T00:10:00Z" } satisfies PostIngestedEvent,
  "market.snapshot.ingested": { date: "2026-10-30" } satisfies MarketSnapshotIngestedEvent,
  "recalc.requested": { reason: "weights_changed", dateFrom: "2026-10-01", dateTo: "2026-10-30" } satisfies RecalcRequestedEvent,
};
