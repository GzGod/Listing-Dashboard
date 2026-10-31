/**
 * The ONLY place the M5 web code knows URL shapes / DTOs. Transport is injectable:
 * harness = fetchJson; base = `@app/ui` api() (see web/base/FrontPage.tsx). Timeouts are owned by the base.
 */
import type { RankingsResponse, TracksResponse } from '../schema/index.js';

/** JSON transport with the same contract as base `@app/ui` api(): resolves the parsed body, throws Error(message) on non-2xx */
export type Fetcher = <T>(url: string) => Promise<T>;
export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!r.ok) throw Object.assign(new Error(body?.error?.message ?? `请求失败 ${r.status}`), { status: r.status });
  return body as T;
}
export interface RankingsParams { track: number; window: number; date: string }
export interface TrackVM { id: number; name: string; parentId: number | null }
export interface RankRowVM { rank: number; rankDelta: number | null; projectId: number; name: string; symbol: string; logoUrl: string | null; detailHref: string; score: number; coveredDays: number; partial: boolean; daily: (number | null)[] }
export interface RankingsVM { trackName: string; window: number; from: string; date: string; rows: RankRowVM[]; noData: { projectId: number; name: string; symbol: string; detailHref: string }[] }

const getJson = <T>(fetcher: Fetcher, url: string): Promise<T> => fetcher<T>(url);

export function createRankingsClient(apiBase: string, fetcher: Fetcher = fetchJson) {
  return {
    async tracks(): Promise<TrackVM[]> {
      return (await getJson<TracksResponse>(fetcher, `${apiBase}/rankings/tracks`)).tracks;
    },
    async rankings(p: RankingsParams): Promise<RankingsVM> {
      const q = new URLSearchParams({ track: String(p.track), window: String(p.window), date: p.date });
      const d = await getJson<RankingsResponse>(fetcher, `${apiBase}/rankings?${q}`);
      return {
        trackName: d.track.name, window: d.window, from: d.from, date: d.date, noData: d.noData,
        rows: d.items.map((it) => ({ rank: it.rank, rankDelta: it.rankDelta, projectId: it.projectId, name: it.name, symbol: it.symbol,
          logoUrl: it.logoUrl, detailHref: it.detailHref, score: it.score, coveredDays: it.coveredDays, partial: it.partial, daily: it.daily })),
      };
    },
  };
}
export type RankingsClient = ReturnType<typeof createRankingsClient>;
