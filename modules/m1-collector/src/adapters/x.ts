// X 抓取适配器：可插拔。配置 m1-collector.xSource 选择 mock | xapi；以后换付费/第三方来源，只需新增一个实现。
import { getJson, rateLimiter, type HttpOpts } from "../http.js";
import fixtures from "../../seed/x-fixtures.json" with { type: "json" };

export interface XPost { id: string; handle: string; postedAt: string; text: string; url: string; views: number; bookmarks: number }
export interface XMetrics { id: string; views: number; bookmarks: number }
export interface XSource {
  readonly name: string;
  userTimeline(handle: string, opts: { sinceId?: string; max: number }): Promise<XPost[]>;
  lookup(ids: string[]): Promise<XMetrics[]>;
}

export class MockXSource implements XSource {
  readonly name = "mock";
  async userTimeline(handle: string, opts: { sinceId?: string; max: number }) {
    return (fixtures.posts as XPost[]).filter((p) => p.handle.toLowerCase() === handle.toLowerCase() && (!opts.sinceId || BigInt(p.id) > BigInt(opts.sinceId))).slice(0, opts.max);
  }
  async lookup(ids: string[]) {
    // 模拟每次回抓指标增长
    return (fixtures.posts as XPost[]).filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, views: p.views + 100, bookmarks: p.bookmarks + 1 }));
  }
}

/** X API v2：users/by/username → users/:id/tweets；tweets?ids= 取 public_metrics。Bearer token 来自 env MOD_M1_COLLECTOR_X_BEARER_TOKEN（或 X_BEARER_TOKEN）。 */
export class XApiSource implements XSource {
  readonly name = "xapi";
  private userIds = new Map<string, string>();
  private limit: () => Promise<void>;
  constructor(private base: string, private token: string, private http: HttpOpts, perMin: number, private budget: { left: number }) {
    if (!token) throw new Error("xapi 需要 X_BEARER_TOKEN");
    this.limit = rateLimiter(perMin);
  }
  private async get(path: string) {
    if (this.budget.left-- <= 0) throw new Error("X 每日调用上限已用完（m1-collector.xDailyCap）");
    await this.limit();
    return getJson(this.base + path, { ...this.http, headers: { authorization: `Bearer ${this.token}` } });
  }
  private async uid(handle: string) {
    if (!this.userIds.has(handle)) { const r = await this.get(`/users/by/username/${encodeURIComponent(handle)}`); this.userIds.set(handle, r.data.id); }
    return this.userIds.get(handle)!;
  }
  async userTimeline(handle: string, opts: { sinceId?: string; max: number }): Promise<XPost[]> {
    const q = new URLSearchParams({ max_results: String(Math.min(100, Math.max(5, opts.max))), "tweet.fields": "created_at,public_metrics", exclude: "retweets,replies" });
    if (opts.sinceId) q.set("since_id", opts.sinceId);
    const r = await this.get(`/users/${await this.uid(handle)}/tweets?${q}`);
    return (r.data ?? []).map((t: any) => ({ id: t.id, handle, postedAt: t.created_at, text: t.text, url: `https://x.com/${handle}/status/${t.id}`,
      views: t.public_metrics?.impression_count ?? 0, bookmarks: t.public_metrics?.bookmark_count ?? 0 }));
  }
  async lookup(ids: string[]): Promise<XMetrics[]> {
    if (!ids.length) return [];
    const r = await this.get(`/tweets?ids=${ids.join(",")}&tweet.fields=public_metrics`);
    return (r.data ?? []).map((t: any) => ({ id: t.id, views: t.public_metrics?.impression_count ?? 0, bookmarks: t.public_metrics?.bookmark_count ?? 0 }));
  }
}
