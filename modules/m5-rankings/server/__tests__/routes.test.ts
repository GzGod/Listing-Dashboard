import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { makeFakeModuleRedis, makeFakeRedisServer } from '../../test-utils/redis.js';
import { T, P, MOCK_FIRST_DAY, P04_MOVE_DAY_INDEX } from '../../test-utils/index.js';
import { MockRankingsRepository } from '../../test-utils/index.js';
import { installTestErrorFormat } from '../../test-utils/http.js';
import { addDays } from '../../lib/day.js';
import plugin, { buildRankings, MemoryCache, RedisRankingsCache, createDailyBatchDoneHandler, cacheKey } from '../index.js';
import { defaultM5Config, staticConfigProvider } from '../../config.js';
import { rankingsResponseSchema, type RankingsResponse } from '../../schema/index.js';

const now = () => new Date('2026-10-31T08:00:00Z');
const MOVE_DAY = addDays(MOCK_FIRST_DAY, P04_MOVE_DAY_INDEX);
async function app(cache: MemoryCache | RedisRankingsCache = new MemoryCache(), config = staticConfigProvider()) {
  const a = Fastify();
  installTestErrorFormat(a); // test-only stand-in for the base's global handler
  await a.register(plugin, { now, cache, config, repo: new MockRankingsRepository() });
  return a;
}
const ids = (r: RankingsResponse) => [...r.items.map((x) => x.projectId), ...r.noData.map((x) => x.projectId)];

describe('GET /rankings', () => {
  it('200, default window 7, default date = yesterday UTC, nulls in daily', async () => {
    const res = await (await app()).inject(`/rankings?track=${T.AI_AGENT}`);
    expect(res.statusCode).toBe(200);
    const body = rankingsResponseSchema.parse(res.json());
    expect(body).toMatchObject({ window: 7, date: '2026-10-30', from: '2026-10-24' });
    expect(body.noData.map((p) => p.projectId)).toContain(P.P19_NO_BUZZ);
    body.items.forEach((it) => expect(it.daily).toHaveLength(7));
    const b30 = rankingsResponseSchema.parse((await (await app()).inject(`/rankings?track=${T.DEFI_PERP}&window=30`)).json());
    expect(b30.items.some((it) => it.daily.includes(null))).toBe(true);
    expect(b30.items.flatMap((it) => it.daily).includes(0)).toBe(false);
  });
  it('competition ranks are consistent and prevRank = previous equal window', async () => {
    const repo = new MockRankingsRepository(); const cfg = defaultM5Config;
    const cur = await buildRankings(repo, cfg, T.DEFI_PERP, 7, '2026-10-30');
    const prev = await buildRankings(repo, cfg, T.DEFI_PERP, 7, '2026-10-23');
    cur.items.forEach((it, i) => { if (i) expect(it.rank).toBeGreaterThanOrEqual(cur.items[i - 1]!.rank); });
    for (const it of cur.items) {
      const p = prev.items.find((x) => x.projectId === it.projectId);
      expect(it.prevRank).toBe(p ? p.rank : null);
    }
  });
  it('historical track: p04 on a date before the move is in ai-infra, NOT in ai-agent; after the move the reverse', async () => {
    const a = await app();
    const before = addDays(MOVE_DAY, -5);
    for (const w of [1, 7]) {
      const infraPast = (await a.inject(`/rankings?track=${T.AI_INFRA}&window=${w}&date=${before}`)).json() as RankingsResponse;
      const agentPast = (await a.inject(`/rankings?track=${T.AI_AGENT}&window=${w}&date=${before}`)).json() as RankingsResponse;
      expect(ids(infraPast)).toContain(P.P04_MOVED);
      expect(ids(agentPast)).not.toContain(P.P04_MOVED);
    }
    const agentNow = (await a.inject(`/rankings?track=${T.AI_AGENT}`)).json() as RankingsResponse;
    const infraNow = (await a.inject(`/rankings?track=${T.AI_INFRA}`)).json() as RankingsResponse;
    expect(ids(agentNow)).toContain(P.P04_MOVED);
    expect(ids(infraNow)).not.toContain(P.P04_MOVED);
  });
  it('brand-new p07 (3 days of data) is not partial in a 30-day window if complete since first snapshot', async () => {
    const body = (await (await app()).inject(`/rankings?track=${T.AI_INFRA}&window=30`)).json() as RankingsResponse;
    const p7 = body.items.find((x) => x.projectId === P.P07_NEW)!;
    expect(p7.coveredDays).toBeLessThanOrEqual(3);
    expect(p7.partial).toBe(p7.coveredDays < 3);
  });
  it('window=1 ranks equal stored track_rank', async () => {
    const body = (await (await app()).inject(`/rankings?track=${T.DEFI_RWA}&window=1`)).json() as RankingsResponse;
    expect(body.items[0]!.rank).toBe(1);
  });
  it.each(['/rankings', `/rankings?track=${T.AI_AGENT}&window=3`, `/rankings?track=${T.AI_AGENT}&date=2026-13-01`, '/rankings?track=999',
    '/rankings?track=abc', '/rankings?track=-1', `/rankings?track=${T.AI}`, `/rankings?track=${T.AI_AGENT}&date=2026-11-05`])('400 for %s', async (url: string) => {
    const r = await (await app()).inject(url);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('BAD_REQUEST');
  });
  it('Redis cache over ctx.redis (prefix m:m5-rankings:, SCAN returns prefixed keys): shared, single prefix, clears only date >= dateFrom', async () => {
    const server = makeFakeRedisServer();
    const c1 = new RedisRankingsCache(makeFakeModuleRedis(server) as never); const c2 = new RedisRankingsCache(makeFakeModuleRedis(server) as never);
    const a1 = await app(c1);
    await a1.inject(`/rankings?track=${T.AI_AGENT}&date=2026-10-20`);
    await a1.inject(`/rankings?track=${T.AI_AGENT}&date=2026-10-29`);
    server.data.set('m:m6-project:2026-10-29:x', { v: '1', exp: Infinity }); // another module's key: must survive
    server.data.set('m:m5-rankings:other', { v: '1', exp: Infinity });        // non-cache key of ours: must survive
    const k29 = cacheKey('2026-10-29', String(T.AI_AGENT), 7);
    expect(server.data.has(`m:m5-rankings:${k29}`)).toBe(true); // exactly one prefix
    expect([...server.data.keys()].some((k) => k.startsWith('m:m5-rankings:m:'))).toBe(false);
    expect(await c2.get(k29)).toBeTruthy(); // visible to another instance
    const logs: string[] = [];
    const r = await createDailyBatchDoneHandler(c2, (m) => logs.push(m))({ dateFrom: '2026-10-25', dateTo: '2026-10-30' });
    expect(r.invalidated).toBe(1);
    expect(await c1.get(cacheKey('2026-10-20', String(T.AI_AGENT), 7))).toBeTruthy();
    expect(await c1.get(k29)).toBeUndefined();
    expect(server.data.has('m:m6-project:2026-10-29:x')).toBe(true);
    expect(server.data.has('m:m5-rankings:other')).toBe(true);
    expect(logs[0]).toContain('2026-10-25~2026-10-30');
    expect((await createDailyBatchDoneHandler(c2)()).invalidated).toBe(1); // no dateFrom => all our cache keys
  });
  it('Redis unavailable: /rankings falls back to the DB (200, same body), never 500', async () => {
    const ok = (await (await app()).inject(`/rankings?track=${T.AI_AGENT}&date=2026-10-29`)).json();
    const down = new RedisRankingsCache(makeFakeModuleRedis(makeFakeRedisServer(), 'm5-rankings', { failing: true }) as never);
    const res = await (await app(down)).inject(`/rankings?track=${T.AI_AGENT}&date=2026-10-29`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ok);
  });
  it('config drives validation and defaults (windows [3,14], default 14, offset -2)', async () => {
    const a = await app(new MemoryCache(), staticConfigProvider({ windows: [3, 14], defaultWindow: 14, defaultDateOffsetDays: -2 }));
    const d = (await a.inject(`/rankings?track=${T.AI_AGENT}`)).json() as RankingsResponse;
    expect(d).toMatchObject({ window: 14, date: '2026-10-29', from: '2026-10-16' });
    expect((await a.inject(`/rankings?track=${T.AI_AGENT}&window=3`)).statusCode).toBe(200);
    expect((await a.inject(`/rankings?track=${T.AI_AGENT}&window=7`)).statusCode).toBe(400);
    expect((await a.inject(`/rankings?track=${T.AI_AGENT}&date=2026-10-30`)).statusCode).toBe(400);
    expect(() => staticConfigProvider({ windows: [3], defaultWindow: 7 })).toThrow();
  });
  it('GET /rankings/tracks', async () => {
    const r = await (await app()).inject('/rankings/tracks');
    expect(r.statusCode).toBe(200);
    expect(r.json().tracks.length).toBe(6);
  });
});

describe('review #10/#11 via mock repo', () => {
  it('null-track snapshot on the date: excluded from 1d and 7d (no fallback); next day with a track: included, null day not summed', async () => {
    const { getMockDb } = await import('../../test-utils/index.js');
    const db = structuredClone(getMockDb());
    const p = db.projects.find((x) => x.track_id === T.AI_AGENT && x.id !== P.P04_MOVED && db.buzz_snapshots.some((s) => s.project_id === x.id && s.day === '2026-10-30'))!;
    for (const s of db.buzz_snapshots) if (s.project_id === p.id && s.day === '2026-10-29') { s.track_id = null; s.track_rank = null; }
    const repo = new MockRankingsRepository(db);
    for (const w of [1, 7, 30]) expect(ids(await buildRankings(repo, defaultM5Config, T.AI_AGENT, w, '2026-10-29'))).not.toContain(p.id);
    const next = await buildRankings(repo, defaultM5Config, T.AI_AGENT, 7, '2026-10-30');
    const it7 = next.items.find((x) => x.projectId === p.id)!;
    expect(it7).toBeTruthy();
    expect(it7.daily[5]).toBeNull(); // 2026-10-29 = index 5 of [10-24..10-30]
  });
  it('fallback to projects.track_id ONLY when no snapshot exists on/before the date', async () => {
    const { getMockDb } = await import('../../test-utils/index.js');
    const db = structuredClone(getMockDb());
    const p = db.projects.find((x) => x.track_id === T.AI_AGENT && x.id !== P.P04_MOVED && db.buzz_snapshots.some((s) => s.project_id === x.id))!;
    db.buzz_snapshots = db.buzz_snapshots.filter((s) => !(s.project_id === p.id && s.day <= '2026-10-29'));
    expect(await new MockRankingsRepository(db).getMembers(T.AI_AGENT, '2026-10-29')).toContainEqual({ projectId: p.id, source: 'current' });
    const db2 = structuredClone(getMockDb());
    for (const s of db2.buzz_snapshots) if (s.project_id === p.id && s.day === '2026-10-29') s.track_id = null;
    const m2 = await new MockRankingsRepository(db2).getMembers(T.AI_AGENT, '2026-10-29');
    expect(m2.some((x) => x.projectId === p.id)).toBe(false);
  });
  it('7d window spanning a track move: whole score goes to the track as of the window END date', async () => {
    const repo = new MockRankingsRepository();
    const end = addDays(MOVE_DAY, 2); // window [end-6, end] contains days before the move
    const after = await buildRankings(repo, defaultM5Config, T.AI_AGENT, 7, end);
    const before = await buildRankings(repo, defaultM5Config, T.AI_INFRA, 7, end);
    expect(ids(after)).toContain(P.P04_MOVED);
    expect(ids(before)).not.toContain(P.P04_MOVED);
  });
});

describe('detailHref (server-filled from m5-rankings.projectDetailHref)', () => {
  it('default template on every item and noData entry', async () => {
    const b = rankingsResponseSchema.parse((await (await app()).inject(`/rankings?track=${T.AI_AGENT}`)).json());
    expect(b.items.length).toBeGreaterThan(0);
    for (const x of [...b.items, ...b.noData]) expect(x.detailHref).toBe(`/m/m6-project/${x.projectId}`);
  });
  it('custom config value', async () => {
    const cfg = staticConfigProvider({ projectDetailHref: '/p/{id}?from=rk&id2={id}' });
    const b = rankingsResponseSchema.parse((await (await app(new MemoryCache(), cfg)).inject(`/rankings?track=${T.AI_AGENT}`)).json());
    for (const x of b.items) expect(x.detailHref).toBe(`/p/${x.projectId}?from=rk&id2=${x.projectId}`);
  });
  it('encodes the id', async () => {
    const { projectHref } = await import('../../config.js');
    expect(projectHref(defaultM5Config, 'a/b c')).toBe('/m/m6-project/a%2Fb%20c');
    expect(projectHref(defaultM5Config, 42)).toBe('/m/m6-project/42');
  });
});

describe('hand-filled day (raw + sub-scores NULL, adjusted_total set)', () => {
  it('ranks by adjusted_total and counts as covered', async () => {
    const { getMockDb } = await import('../../test-utils/index.js');
    const db = structuredClone(getMockDb());
    const p = db.projects.find((x) => x.track_id === T.AI_AGENT && x.id !== P.P04_MOVED && db.buzz_snapshots.some((s) => s.project_id === x.id && s.day === '2026-10-30'))!;
    const before = await buildRankings(new MockRankingsRepository(structuredClone(db)), defaultM5Config, T.AI_AGENT, 7, '2026-10-30');
    // the crawler missed 10-27: remove it, then fill by hand with a huge adjusted_total
    db.buzz_snapshots = db.buzz_snapshots.filter((s) => !(s.project_id === p.id && s.day === '2026-10-27'));
    const tmpl = db.buzz_snapshots.find((s) => s.project_id === p.id && s.day === '2026-10-26')!;
    db.buzz_snapshots.push({ ...tmpl, day: '2026-10-27', raw_total: null, kol_post_count: null, core_exposure_count: null, heat_score: null, adjusted_total: 1e6 });
    const r = await buildRankings(new MockRankingsRepository(db), defaultM5Config, T.AI_AGENT, 7, '2026-10-30');
    const it7 = r.items.find((x) => x.projectId === p.id)!;
    expect(it7.rank).toBe(1);
    expect(it7.daily[3]).toBe(1e6);                // 10-27 = index 3 of [10-24..10-30]
    expect(it7.coveredDays).toBe(before.items.find((x) => x.projectId === p.id)!.coveredDays);
    expect(it7.partial).toBe(false);
  });
});
