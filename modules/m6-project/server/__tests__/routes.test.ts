import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { P } from '../../test-utils/index.js';
import { MockProjectRepository } from '../../test-utils/index.js';
import { installTestErrorFormat } from '../../test-utils/http.js';
import plugin from '../index.js';
import { staticConfigProvider } from '../../config.js';
import { postsResponseSchema, projectDetailSchema, seriesResponseSchema } from '../../schema/index.js';

const now = () => new Date('2026-10-31T08:00:00Z');
async function app(config = staticConfigProvider(), logs: string[] = []) { const a = Fastify(); installTestErrorFormat(a); await a.register(plugin, { now, config, repo: new MockProjectRepository(), log: (m) => logs.push(m) }); return a; }

describe('m6 routes', () => {
  it('GET /projects/:id 200 with dates of the data actually used', async () => {
    const r = await (await app()).inject('/projects/1');
    expect(r.statusCode).toBe(200);
    const b = projectDetailSchema.parse(r.json());
    expect(b.track?.parent?.id).toBe(1);
    expect(b.volume!.date <= '2026-10-30').toBe(true);
    expect(b.buzzBreakdown!.rankInTrack).toBeGreaterThan(0);
    expect(b.volume!.byExchange.length).toBeGreaterThan(0);
    expect(b.fundamentals.userCount).toMatchObject({ source: 'Dune' });
  });
  it('project with no data -> nulls; invalid JSON is logged and treated as missing', async () => {
    const b = projectDetailSchema.parse((await (await app()).inject(`/projects/${P.P20_NO_DATA}`)).json());
    expect(b.buzzBreakdown).toBeNull(); expect(b.volume).toBeNull(); expect(b.latestPriceUsd).toBeNull(); expect(b.fundamentals.rating).toBeNull();
    const logs: string[] = [];
    const c = projectDetailSchema.parse((await (await app(undefined, logs)).inject(`/projects/${P.P11_BAD_JSON}`)).json());
    expect(c.fundamentals.capTable).toEqual([]); expect(logs.some((l) => l.includes('fundamentals'))).toBe(true);
  });
  it('404 / 400 on id', async () => {
    const a = await app();
    for (const u of ['/projects/999', '/projects/999/series', '/projects/999/posts']) expect((await a.inject(u)).statusCode).toBe(404);
    for (const u of ['/projects/abc', '/projects/0', '/projects/-3', '/projects/1.5/series']) {
      const r = await a.inject(u); expect(r.statusCode, u).toBe(400); expect(r.json().error.code).toBe('BAD_REQUEST');
    }
  });
  it('series 200 aligned daily; stage mapped preannounce->teaser; exchange names', async () => {
    const b = seriesResponseSchema.parse((await (await app()).inject('/projects/2/series?range=90d')).json());
    expect(b.points).toHaveLength(90);
    expect(b.points.at(-1)!.date).toBe('2026-10-30');
    expect(b.points.flatMap((p) => [p.buzzScore, p.priceUsd]).includes(0)).toBe(false);
    b.listingEvents.forEach((e) => { expect(['Binance', 'OKX', 'Bybit', 'Bitget', 'Gate']).toContain(e.exchange); expect(e.date >= b.points[0]!.date).toBe(true); });
  });
  it('400s on query', async () => {
    const a = await app();
    for (const u of ['/projects/1/series?range=1h', '/projects/1/series?range=365d', '/projects/1/posts?range=1d', '/projects/1/posts?cursor=@@', '/projects/1/posts?limit=500'])
      expect((await a.inject(u)).statusCode, u).toBe(400);
  });
  it('posts: confirmed only, desc by (postedAt, postId), cursor pages with no overlap until null', async () => {
    const a = await app();
    let c: string | null = null; const seen = new Set<number>(); let prev: { t: string; id: number } | null = null; let pages = 0;
    do {
      const pg = postsResponseSchema.parse((await a.inject(`/projects/2/posts?range=7d&limit=5${c ? `&cursor=${c}` : ''}`)).json());
      for (const x of pg.items) {
        expect(seen.has(x.postId)).toBe(false); seen.add(x.postId);
        expect(x.postedAt >= '2026-10-24').toBe(true);
        if (prev) expect(prev.t > x.postedAt || (prev.t === x.postedAt && prev.id > x.postId)).toBe(true);
        prev = { t: x.postedAt, id: x.postId };
      }
      c = pg.nextCursor; pages++;
    } while (c && pages < 100);
    expect(c).toBeNull(); expect(seen.size).toBeGreaterThan(0);
    expect(postsResponseSchema.parse((await a.inject(`/projects/${P.P20_NO_DATA}/posts`)).json()).items).toEqual([]);
  });
  it('config drives ranges, defaults and page size', async () => {
    const a = await app(staticConfigProvider({ ranges: { '3d': 3, '14d': 14 }, defaultSeriesRange: '14d', defaultPostsRange: '3d', postsPageSize: 4, postsMaxPageSize: 8 }));
    expect(seriesResponseSchema.parse((await a.inject('/projects/1/series')).json()).points).toHaveLength(14);
    expect((await a.inject('/projects/1/series?range=30d')).statusCode).toBe(400);
    const pg = postsResponseSchema.parse((await a.inject('/projects/2/posts')).json());
    expect(pg.items.length).toBeLessThanOrEqual(4);
    pg.items.forEach((x) => expect(x.postedAt >= '2026-10-28').toBe(true));
    expect((await a.inject('/projects/2/posts?limit=9')).statusCode).toBe(400);
    expect(() => staticConfigProvider({ ranges: { '3d': 3 } })).toThrow();
  });
});
