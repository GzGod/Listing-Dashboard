import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { getMockDb, type MockDb } from '../../test-utils/index.js';
import { MockProjectRepository } from '../../test-utils/index.js';
import { installTestErrorFormat } from '../../test-utils/http.js';
import plugin from '../index.js';
import { mapListingRows } from '../repository.js';
import { decodeCursor, encodeCursor } from '../series.js';
import { postsResponseSchema, seriesResponseSchema } from '../../schema/index.js';

const now = () => new Date('2026-10-31T08:00:00Z');
const clone = (): MockDb => structuredClone(getMockDb());
async function app(db: MockDb, stageLog: unknown[] = []) {
  const a = Fastify(); installTestErrorFormat(a);
  await a.register(plugin, { now, repo: new MockProjectRepository(db, (i) => stageLog.push(i)), log: () => undefined });
  return a;
}

describe('posts cursor keeps millisecond precision (timestamp(3))', () => {
  it('several posts in the same second: no dups, no gaps across pages', async () => {
    const db = clone();
    const PID = 999; const person = db.people[0]!.id;
    db.projects.push({ ...db.projects[0]!, id: PID, name: 'SameSecond', symbol: 'SS' });
    // 7 posts within 2026-10-30T12:00:00 (µs differ, some identical timestamps -> id tie-break), 2 just outside
    const stamps = ['12:00:00.001', '12:00:00.002', '12:00:00.500', '12:00:00.500', '12:00:00.999', '12:00:00.999', '12:00:00.123', '11:59:59.999', '12:00:01.000'];
    stamps.forEach((t, i) => {
      const id = 900000 + i;
      db.posts.push({ id, person_id: person, platform: 'x', posted_at: `2026-10-30T${t}Z`, views: 1, bookmarks: 0, url: `https://x.com/a/status/${id}` });
      db.post_mentions.push({ post_id: id, project_id: PID, match_method: 'ticker', status: 'confirmed' });
    });
    const a = await app(db);
    const seen: number[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const res = await a.inject(`/projects/${PID}/posts?range=7d&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode).toBe(200);
      const b = postsResponseSchema.parse(res.json());
      seen.push(...b.items.map((p) => p.postId)); cursor = b.nextCursor; pages++;
    } while (cursor && pages < 20);
    expect(new Set(seen).size).toBe(seen.length); // no dups
    expect(seen.sort()).toEqual(stamps.map((_, i) => 900000 + i).sort()); // no gaps
  });
  it('cursor round-trips ms timestamps verbatim, rejects other precisions', () => {
    const c = { postedAt: '2026-10-30T12:00:00.123Z', postId: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({ postedAt: '2026-10-30T12:00:00Z', postId: 1 }))).toBeNull();
    expect(decodeCursor(encodeCursor({ postedAt: '2026-10-30T12:00:00.123456Z', postId: 1 }))).toBeNull();
  });
});

describe('unknown listing stage is logged and skipped (review #8)', () => {
  it('mapListingRows never defaults to spot', () => {
    const logs: unknown[] = [];
    const out = mapListingRows([{ id: 1, stage: 'spot' }, { id: 2, stage: 'delist' }, { id: 3, stage: 'preannounce' }, { id: 4, stage: 'toString' }], (i) => logs.push(i));
    expect(out).toEqual([{ id: 1, stage: 'spot' }, { id: 3, stage: 'teaser' }]);
    expect(logs).toEqual([{ listingEventId: 2, stage: 'delist' }, { listingEventId: 4, stage: 'toString' }]);
  });
  it('series endpoint drops the unknown event and logs it', async () => {
    const db = clone();
    const pid = db.projects[0]!.id;
    db.listing_events.push({ id: 777777, project_id: pid, exchange_id: 1, day: '2026-10-29', stage: 'weird' as never, pair: null, announcement_url: null });
    const logs: unknown[] = [];
    const res = await (await app(db, logs)).inject(`/projects/${pid}/series?range=7d`);
    expect(res.statusCode).toBe(200);
    const b = seriesResponseSchema.parse(res.json());
    expect(b.listingEvents.some((e) => e.id === 777777)).toBe(false);
    expect(logs).toContainEqual({ listingEventId: 777777, stage: 'weird' });
  });
});

describe('post_mentions.status: only confirmed counts', () => {
  it('pending/rejected mentions are excluded', async () => {
    const db = clone();
    const PID = 998; const person = db.people[0]!.id;
    db.projects.push({ ...db.projects[0]!, id: PID, name: 'StatusP', symbol: 'SP' });
    (['pending', 'confirmed', 'rejected'] as const).forEach((status, i) => {
      const id = 910000 + i;
      db.posts.push({ id, person_id: person, platform: 'x', posted_at: `2026-10-30T10:00:0${i}.000Z`, views: 1, bookmarks: 0, url: `https://x.com/a/status/${id}` });
      db.post_mentions.push({ post_id: id, project_id: PID, match_method: 'ticker', status });
    });
    const b = postsResponseSchema.parse((await (await app(db)).inject(`/projects/${PID}/posts?range=7d`)).json());
    expect(b.items.map((p) => p.postId)).toEqual([910001]);
  });
});

describe('null-track days (rule change): M6 still shows price and volume', () => {
  it('series and detail keep price/volume when project_daily / buzz_snapshots track_id IS NULL', async () => {
    const db = clone();
    const pid = db.projects[0]!.id;
    for (const r of db.project_daily) if (r.project_id === pid && r.day >= '2026-10-28') { r.track_id = null; r.volume_track_rank = null; }
    for (const r of db.buzz_snapshots) if (r.project_id === pid && r.day >= '2026-10-28') { r.track_id = null; r.track_rank = null; }
    const a = await app(db);
    const ser = seriesResponseSchema.parse((await a.inject(`/projects/${pid}/series?range=7d`)).json());
    const d30 = ser.points.find((p) => p.date === '2026-10-30')!;
    const src = db.project_daily.find((r) => r.project_id === pid && r.day === '2026-10-30')!;
    expect(d30.spotVolumeUsd24h).toBe(src.total_spot_volume_usd);
    expect(d30.priceUsd).toBe(src.price_usd);
    expect(d30.volumeRankInTrack).toBeNull();
    expect(d30.buzzScore).not.toBeNull();
    const det = (await a.inject(`/projects/${pid}`)).json();
    expect(det.volume?.spotVolumeUsd24h).toBe(src.total_spot_volume_usd);
    expect(det.volume?.rankInTrack).toBeNull();
    expect(det.latestPriceUsd).toBe(src.price_usd ?? det.latestPriceUsd);
  });
});

describe('hand-filled day: M6 breakdown sub-scores are null (暂无数据), total + rank shown', () => {
  it('API returns null sub-scores (never 0) with adjustedScore/rankInTrack; UI cells show 暂无数据', async () => {
    const { buzzCells } = await import('../../web/buzz-cells.js');
    const { defaultM6Config } = await import('../../config.js');
    const db = clone();
    const pid = db.projects[0]!.id;
    const latest = db.buzz_snapshots.filter((r) => r.project_id === pid && r.day <= '2026-10-30').sort((a, b) => b.day.localeCompare(a.day))[0]!;
    Object.assign(latest, { raw_total: null, kol_post_count: null, core_exposure_count: null, heat_score: null, adjusted_total: 77.5, track_rank: 2 });
    const a = await app(db);
    const det = (await a.inject(`/projects/${pid}`)).json();
    expect(det.buzzBreakdown).toMatchObject({ date: latest.day, kolPostCount: null, coreExposureCount: null, heatScore: null, adjustedScore: 77.5, rankInTrack: 2 });
    const ser = seriesResponseSchema.parse((await a.inject(`/projects/${pid}/series?range=7d`)).json());
    expect(ser.points.find((p) => p.date === latest.day)).toMatchObject({ buzzScore: 77.5, kolPostCount: null, heatScore: null, coreExposureCount: null });
    const E = defaultM6Config.labels.noData;
    const cells = Object.fromEntries(buzzCells(det.buzzBreakdown, E, (n) => String(n)));
    expect(E).toBe('暂无数据');
    expect(cells).toEqual({ 'KOL 发帖数': E, '核心人物时间线曝光': E, '热度分': E, '调整后声量分': '77.5', '赛道内排名': '#2' });
  });
});
