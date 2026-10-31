import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { AppError } from '@app/core';
import { addDays, dayStartUtcIso } from '../lib/day.js';
import { latestDay, staticConfigProvider, type ConfigProvider, type M6Config } from '../config.js';
import { makePostsQuerySchema, makeSeriesQuerySchema, projectParamsSchema, type PostsResponse, type ProjectDetail, type SeriesResponse } from '../schema/index.js';
import { type ProjectRepository } from './repository.js';
import { alignSeries, decodeCursor, encodeCursor } from './series.js';
import { mapFundamentals, mapLinks, mapLogo, type Log } from './fundamentals-mapping.js';

export interface M6PluginOptions {
  config?: ConfigProvider<M6Config>;
  /** REQUIRED: PgProjectRepository in the base; tests/harness inject the mock from ../test-utils (tests/harness) */
  repo: ProjectRepository;
  now?: () => Date;
  /** base: ctx.requirePermission('core:read') */
  auth?: preHandlerHookHandler;
  log?: Log;
}

type ZodLikeError = { issues: { path: PropertyKey[]; message: string }[] };
const bad = (e: ZodLikeError | string) => new AppError(400, 'BAD_REQUEST', typeof e === 'string' ? e : e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
const notFound = () => new AppError(404, 'NOT_FOUND', '项目不存在');

const m6ProjectPlugin: FastifyPluginAsync<M6PluginOptions> = async (app, opts) => {
  const cfg = (opts.config ?? staticConfigProvider()).get();
  const repo = opts.repo;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => app.log.warn(m));
  const seriesQuerySchema = makeSeriesQuerySchema(cfg);
  const postsQuerySchema = makePostsQuerySchema(cfg);
  const days = (k: string) => cfg.ranges[k] ?? 0; // validated by schema
  const pre = opts.auth ? { preHandler: opts.auth } : {};
  const projectId = (params: unknown) => { const p = projectParamsSchema.safeParse(params); if (!p.success) throw bad(p.error); return p.data.id; };

  app.get('/projects/:id', pre, async (req) => {
    const id = projectId(req.params);
    const project = await repo.getProject(id);
    if (!project) throw notFound();
    const asOf = latestDay(cfg, now()); // most recent complete day in cfg.dayCutTimezone; each block reports the actual day it used
    const [track, contracts, buzz, vol, price] = await Promise.all([
      project.trackId != null ? repo.getTrack(project.trackId) : null, repo.getContracts(id), repo.getLatestBuzz(id, asOf),
      repo.getLatestMarket(id, asOf, 'volume'), repo.getLatestMarket(id, asOf, 'price')]);
    const parent = track?.parentId != null ? await repo.getTrack(track.parentId) : null;
    const byExchange = vol ? await repo.getExchangeVolumes(id, vol.day) : [];
    const body: ProjectDetail = {
      id, name: project.name, symbol: project.symbol, logoUrl: mapLogo(project.profile),
      track: track ? { id: track.id, name: track.name, parent: parent ? { id: parent.id, name: parent.name } : null } : null,
      contracts, links: mapLinks(project.profile),
      fundamentals: mapFundamentals(id, project.profile, log),
      buzzBreakdown: buzz ? { date: buzz.day, kolPostCount: buzz.kolPostCount, coreExposureCount: buzz.coreExposureCount, heatScore: buzz.heatScore,
        adjustedScore: buzz.adjustedTotal, rankInTrack: buzz.trackRank } : null,
      volume: vol && vol.totalSpotVolumeUsd !== null ? { date: vol.day, spotVolumeUsd24h: vol.totalSpotVolumeUsd, rankInTrack: vol.volumeTrackRank,
        byExchange: byExchange.sort((a, b) => b.volumeUsd - a.volumeUsd) } : null,
      latestPriceUsd: price?.priceUsd ?? null, latestPriceDate: price?.day ?? null,
    };
    return body;
  });

  app.get('/projects/:id/series', pre, async (req) => {
    const id = projectId(req.params);
    const q = seriesQuerySchema.safeParse(req.query);
    if (!q.success) throw bad(q.error);
    if (!(await repo.getProject(id))) throw notFound();
    const to = latestDay(cfg, now());
    const from = addDays(to, -(days(q.data.range) - 1));
    const [buzz, market, events] = await Promise.all([repo.getBuzzRange(id, from, to), repo.getMarketRange(id, from, to), repo.getListingEvents(id, from, to)]);
    const body: SeriesResponse = {
      points: alignSeries(from, to, buzz, market),
      listingEvents: events.sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id)
        .map(({ id: eid, exchange, stage, day, pair, announcementUrl }) => ({ id: eid, exchange, stage, date: day, pair, announcementUrl })),
    };
    return body;
  });

  app.get('/projects/:id/posts', pre, async (req) => {
    const id = projectId(req.params);
    const q = postsQuerySchema.safeParse(req.query);
    if (!q.success) throw bad(q.error);
    const after = q.data.cursor ? decodeCursor(q.data.cursor) : null;
    if (q.data.cursor && !after) throw bad('cursor 无效');
    if (!(await repo.getProject(id))) throw notFound();
    const to = latestDay(cfg, now());
    // range start = 00:00 in the day-cut zone, converted to the UTC instant (posts.posted_at is stored in UTC)
    const fromIso = dayStartUtcIso(addDays(to, -(days(q.data.range) - 1)), cfg.dayCutTimezone);
    const rows = await repo.getConfirmedPosts(id, fromIso, after, q.data.limit + 1);
    const page = rows.slice(0, q.data.limit);
    const last = page[page.length - 1];
    const body: PostsResponse = {
      items: page.map((p) => ({ postId: p.postId, url: p.url, platform: p.platform, postedAt: p.postedAt, views: p.views, bookmarks: p.bookmarks,
        author: p.author, matchType: p.matchMethod })),
      nextCursor: rows.length > q.data.limit && last ? encodeCursor({ postedAt: last.postedAt, postId: last.postId }) : null,
    };
    return body;
  });
};

export default m6ProjectPlugin;
