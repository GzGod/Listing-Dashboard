/**
 * The ONLY place the M6 web code knows URL shapes / DTOs. If M3/@app/shared redefines the contracts,
 * change only this file (params + DTO -> view model mapping); components consume the VMs below.
 */
import type { ApiListingStage, PostsResponse, ProjectDetail, SeriesResponse } from '../schema/index.js';

export type ProjectVM = ProjectDetail; // detail DTO is already view-shaped; keep alias so components never import DTOs
export interface PostVM { id: number; url: string; postedAt: string; views: number | null; bookmarks: number | null; authorName: string; handle: string; kolTier: string | null; tags: string[]; matchType: string }
export interface PostsPageVM { items: PostVM[]; nextCursor: string | null }
export interface ListingMarkVM { id: number; date: string; stage: ApiListingStage; exchange: string; pair: string | null; url: string | null }
export interface SeriesVM {
  dates: string[]; buzz: (number | null)[]; price: (number | null)[]; volume: (number | null)[];
  kolPosts: (number | null)[]; coreExposure: (number | null)[]; heat: (number | null)[]; volumeRank: (number | null)[];
  events: ListingMarkVM[];
}

export class NotFoundError extends Error {}
/** JSON transport with the same contract as base `@app/ui` api(): resolves the parsed body, throws Error(message) on non-2xx */
export type Fetcher = <T>(url: string) => Promise<T>;
export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!r.ok) throw Object.assign(new Error(body?.error?.message ?? `请求失败 ${r.status}`), { status: r.status });
  return body as T;
}
async function getJson<T>(fetcher: Fetcher, url: string): Promise<T> {
  try { return await fetcher<T>(url); } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 404) throw new NotFoundError(err.message); // base api() throws ApiRequestError with .status
    throw e;
  }
}

/** transport injectable (harness: fetchJson; base: @app/ui api()). Timeouts are owned by the base. */
export function createProjectClient(apiBase: string, fetcher: Fetcher = fetchJson) {
  const base = (id: number) => `${apiBase}/projects/${id}`;
  return {
    detail: (id: number): Promise<ProjectVM> => getJson<ProjectDetail>(fetcher, base(id)),
    async series(id: number, range: string): Promise<SeriesVM> {
      const d = await getJson<SeriesResponse>(fetcher, `${base(id)}/series?range=${encodeURIComponent(range)}`);
      const col = <K extends keyof SeriesResponse['points'][number]>(k: K) => d.points.map((p) => p[k] as number | null);
      return { dates: d.points.map((p) => p.date), buzz: col('buzzScore'), price: col('priceUsd'), volume: col('spotVolumeUsd24h'),
        kolPosts: col('kolPostCount'), coreExposure: col('coreExposureCount'), heat: col('heatScore'), volumeRank: col('volumeRankInTrack'),
        events: d.listingEvents.map((e) => ({ id: e.id, date: e.date, stage: e.stage, exchange: e.exchange, pair: e.pair, url: e.announcementUrl })) };
    },
    async posts(id: number, range: string, cursor?: string | null): Promise<PostsPageVM> {
      const q = new URLSearchParams({ range });
      if (cursor) q.set('cursor', cursor);
      const d = await getJson<PostsResponse>(fetcher, `${base(id)}/posts?${q}`);
      return { nextCursor: d.nextCursor, items: d.items.map((p) => ({ id: p.postId, url: p.url, postedAt: p.postedAt, views: p.views, bookmarks: p.bookmarks,
        authorName: p.author.name, handle: p.author.handle, kolTier: p.author.kolTier, tags: p.author.tags, matchType: p.matchType })) };
    },
  };
}
export type ProjectClient = ReturnType<typeof createProjectClient>;
