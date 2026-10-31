import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { AppError } from '@app/core';
import { addDays } from '../lib/day.js';
import { defaultDate, projectHref, staticConfigProvider, type ConfigProvider, type M5Config } from '../config.js';
import { makeRankingsQuerySchema, type RankingsResponse, type TracksResponse } from '../schema/index.js';
import { type RankingsRepository } from './repository.js';
import { SnapshotWindowAggregator, type WindowAggregator } from './aggregator.js';
import { cacheKey, MemoryCache, type RankingsCache } from './cache.js';

export interface M5PluginOptions {
  /** replaced by base config via loadM5ConfigFromBase(ctx.config) */
  config?: ConfigProvider<M5Config>;
  /** REQUIRED: PgRankingsRepository in the base; tests/harness inject the mock from ../test-utils (tests/harness) */
  repo: RankingsRepository;
  aggregator?: WindowAggregator;
  /** RedisRankingsCache in base/production; MemoryCache only for the single-process harness */
  cache?: RankingsCache;
  now?: () => Date;
  /** base: ctx.requirePermission('core:read'). Harness: none. */
  auth?: preHandlerHookHandler;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export async function buildRankings(repo: RankingsRepository, cfg: M5Config, trackId: number, window: number, date: string,
  aggregator: WindowAggregator = new SnapshotWindowAggregator(repo)): Promise<RankingsResponse> {
  const t = await repo.getTrack(trackId);
  if (!t) throw new AppError(400, 'BAD_REQUEST', '未知的细分赛道 id');
  if (t.parentId === null) throw new AppError(400, 'BAD_REQUEST', 'track 必须是细分赛道（不提供跨赛道总榜）');
  const [cur, prev] = await Promise.all([
    aggregator.aggregate({ trackId, window, date }),
    aggregator.aggregate({ trackId, window, date: addDays(date, -window) }), // previous equal-length window
  ]);
  const prevMap = new Map(prev.ranked.map((r) => [r.projectId, r.rank]));
  const projects = new Map((await repo.getProjects([...cur.ranked.map((r) => r.projectId), ...cur.noData])).map((p) => [p.id, p]));
  return {
    track: { id: t.id, name: t.name, parentId: t.parentId }, window, date, from: cur.from,
    items: cur.ranked.map((r) => {
      const p = projects.get(r.projectId);
      const prevRank = prevMap.get(r.projectId) ?? null;
      return { rank: r.rank, prevRank, rankDelta: prevRank === null ? null : prevRank - r.rank, projectId: r.projectId,
        name: p?.name ?? String(r.projectId), symbol: p?.symbol ?? '', logoUrl: p?.logoUrl ?? null, detailHref: projectHref(cfg, r.projectId),
        score: round(r.score, cfg.scoreDecimals), coveredDays: r.coveredDays, partial: r.partial,
        daily: r.daily.map((v) => (v === null ? null : round(v, cfg.scoreDecimals))) };
    }),
    noData: cur.noData.map((id) => ({ projectId: id, name: projects.get(id)?.name ?? String(id), symbol: projects.get(id)?.symbol ?? '', detailHref: projectHref(cfg, id) })),
  };
}

const m5RankingsPlugin: FastifyPluginAsync<M5PluginOptions> = async (app, opts) => {
  const cfg = (opts.config ?? staticConfigProvider()).get();
  const repo = opts.repo;
  const aggregator = opts.aggregator ?? new SnapshotWindowAggregator(repo);
  const cache = opts.cache ?? new MemoryCache();
  const now = opts.now ?? (() => new Date());
  const querySchema = makeRankingsQuerySchema(cfg);
  const pre = opts.auth ? { preHandler: opts.auth } : {};

  app.get('/rankings', pre, async (req) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'BAD_REQUEST', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const { track, window } = parsed.data;
    const maxDate = defaultDate(cfg, now());
    const date = parsed.data.date ?? maxDate;
    if (date > maxDate) throw new AppError(400, 'BAD_REQUEST', `date 不能晚于 ${maxDate}`);
    const key = cacheKey(date, String(track), window);
    // Redis (ctx.redis) down/erroring must never fail the request: fall back to the DB and skip caching
    const hit = await cache.get<RankingsResponse>(key).catch((e: unknown) => { req.log.warn({ err: e }, '[m5-rankings] cache get failed; reading DB'); return undefined; });
    if (hit) return hit;
    const res = await buildRankings(repo, cfg, track, window, date, aggregator);
    await cache.set(key, res, cfg.cacheTtlSec * 1000).catch((e: unknown) => { req.log.warn({ err: e }, '[m5-rankings] cache set failed; not cached'); });
    return res;
  });

  // helper for the frontend tabs (not part of the approved spec; see README)
  app.get('/rankings/tracks', pre, async (): Promise<TracksResponse> => ({ tracks: await repo.listTracks() }));
};

export default m5RankingsPlugin;
