import { getJson, rateLimiter, type HttpOpts } from "../http.js";
import fixtures from "../../seed/x-fixtures.json" with { type: "json" };

export interface XMetrics { id: string; views: number | null; bookmarks: number | null }
export interface XPost extends XMetrics { handle: string; postedAt: string; text: string; url: string }
export interface TimelineOpts { sinceId?: string; max: number; nextToken?: string }
export interface XPage { posts: XPost[]; nextToken?: string; newestId?: string }
export interface XSource {
  readonly name: string;
  userTimelinePage(handle: string, opts: TimelineOpts): Promise<XPage>;
  userTimeline(handle: string, opts: TimelineOpts): Promise<XPost[]>;
  lookup(ids: string[]): Promise<XMetrics[]>;
}
export class MockXSource implements XSource {
  readonly name = "mock";
  async userTimelinePage(handle: string, opts: TimelineOpts): Promise<XPage> {
    const all = (fixtures.posts as XPost[]).filter((p) => p.handle.toLowerCase() === handle.toLowerCase() && (!opts.sinceId || BigInt(p.id) > BigInt(opts.sinceId)))
      .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
    const start = Number(opts.nextToken ?? 0); const posts = all.slice(start, start + opts.max);
    return { posts, newestId: all[0]?.id, nextToken: start + opts.max < all.length ? String(start + opts.max) : undefined };
  }
  async userTimeline(handle: string, opts: TimelineOpts) { return (await this.userTimelinePage(handle, opts)).posts; }
  async lookup(ids: string[]) {
    return (fixtures.posts as XPost[]).filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, views: p.views == null ? null : p.views + 100, bookmarks: p.bookmarks == null ? null : p.bookmarks + 1 }));
  }
}
const metric = (n: unknown): number | null => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
const id = (n: unknown): n is string => typeof n === "string" && /^\d+$/.test(n);
export function parseXMetrics(t: any): XMetrics {
  if (!id(t?.id)) throw new Error("X 帖子缺少有效 ID");
  return { id: t.id, views: metric(t.public_metrics?.impression_count), bookmarks: metric(t.public_metrics?.bookmark_count) };
}

export class XApiSource implements XSource {
  readonly name = "xapi";
  private userIds = new Map<string, string>();
  private limit: () => Promise<void>;
  constructor(private base: string, private token: string, private http: HttpOpts, perMin: number,
    private budget: { left: number; consume?: () => Promise<void> },
    private userCache?: { get: (handle: string) => Promise<string | undefined>; set: (handle: string, id: string) => Promise<void> }) {
    if (!token) throw new Error("xapi 需要 X_BEARER_TOKEN");
    this.limit = rateLimiter(perMin);
  }
  private async get(path: string, allowMissing = false): Promise<any> {
    const result = await getJson(this.base + path, { ...this.http, headers: { ...this.http.headers, authorization: `Bearer ${this.token}` }, beforeAttempt: async () => {
      await this.limit();
      if (this.budget.consume) await this.budget.consume();
      else { if (this.budget.left <= 0) throw new Error("X 每日调用上限已用完"); this.budget.left--; }
      await this.http.beforeAttempt?.();
    } });
    if (!result || typeof result !== "object" || (!allowMissing && result.errors?.length && !result.data)) throw new Error("X API 未返回可用数据，请检查账号、权限和接口额度");
    return result;
  }
  private async uid(rawHandle: string) {
    const handle = rawHandle.replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw new Error("X 账号格式不正确");
    if (!this.userIds.has(handle)) {
      const cached = await this.userCache?.get(handle);
      if (cached && id(cached)) this.userIds.set(handle, cached);
      else {
        const r = await this.get(`/users/by/username/${encodeURIComponent(handle)}`);
        if (!id(r.data?.id)) throw new Error("X 用户不存在或响应缺少 ID");
        this.userIds.set(handle, r.data.id); await this.userCache?.set(handle, r.data.id);
      }
    }
    return this.userIds.get(handle)!;
  }
  async userTimelinePage(handle: string, opts: TimelineOpts): Promise<XPage> {
    const q = new URLSearchParams({ max_results: String(Math.min(100, Math.max(5, opts.max))), "tweet.fields": "created_at,public_metrics", exclude: "retweets,replies" });
    if (opts.sinceId) q.set("since_id", opts.sinceId);
    if (opts.nextToken) q.set("pagination_token", opts.nextToken);
    const r = await this.get(`/users/${await this.uid(handle)}/tweets?${q}`);
    if (r.data != null && !Array.isArray(r.data)) throw new Error("X 时间线响应格式不正确");
    if (r.errors?.length) throw new Error("X 时间线返回部分错误，保留分页断点等待重试");
    const posts = (r.data ?? []).map((t: any): XPost => {
      const metrics = parseXMetrics(t);
      if (typeof t.text !== "string" || typeof t.created_at !== "string" || !Number.isFinite(Date.parse(t.created_at))) throw new Error("X 帖子正文或发帖时间无效");
      return { ...metrics, handle, postedAt: t.created_at, text: t.text, url: `https://x.com/${handle.replace(/^@/, "")}/status/${t.id}` };
    });
    return { posts, nextToken: typeof r.meta?.next_token === "string" ? r.meta.next_token : undefined,
      newestId: id(r.meta?.newest_id) ? r.meta.newest_id : posts.map((p: XPost) => p.id).sort((a: string, b: string) => BigInt(a) > BigInt(b) ? -1 : 1)[0] };
  }
  async userTimeline(handle: string, opts: TimelineOpts): Promise<XPost[]> {
    const all: XPost[] = []; let token = opts.nextToken;
    do { const page = await this.userTimelinePage(handle, { ...opts, nextToken: token }); all.push(...page.posts); token = page.nextToken; } while (token);
    return all;
  }
  async lookup(ids: string[]): Promise<XMetrics[]> {
    if (!ids.length) return [];
    if (ids.length > 100 || !ids.every(id)) throw new Error("X 指标查询需为最多 100 个有效数字 ID");
    const r = await this.get(`/tweets?ids=${ids.join(",")}&tweet.fields=public_metrics`, true);
    if (r.data != null && !Array.isArray(r.data)) throw new Error("X 指标响应格式不正确");
    return (r.data ?? []).map(parseXMetrics).filter((p: XMetrics) => ids.includes(p.id));
  }
}
