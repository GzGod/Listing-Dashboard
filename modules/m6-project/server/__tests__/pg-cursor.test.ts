/**
 * Posts keyset cursor vs posts.posted_at = timestamp(3) WITHOUT time zone.
 * - SQL-text assertions + an Asia/Shanghai TZ round trip always run.
 * - The real-Postgres part runs when PG_TEST_URL is set (e.g. postgres://postgres@%2Ftmp:55432/postgres); it creates a
 *   throwaway schema, sets the SESSION TimeZone to Asia/Shanghai and pages through same-second posts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import * as q from '../queries.js';
import type { CoreDb } from '../queries.js';
import { PgProjectRepository } from '../repository.js';
import { decodeCursor, encodeCursor } from '../series.js';

const capture = () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const db: CoreDb = { $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push({ text: strings.join('?'), values }); return [] as never; } };
  return { db, calls };
};

describe('posts SQL text (no session-TZ dependence)', () => {
  it('prints posted_at with to_char(...MS) and compares with ::timestamp, never timestamptz / AT TIME ZONE', async () => {
    const { db, calls } = capture();
    await q.getConfirmedPosts(db, 1, '2026-10-01T00:00:00.000Z', { postedAt: '2026-10-30T12:00:00.123Z', postId: 9 }, 21);
    const t = calls[0]!.text;
    expect(t).toContain(`to_char(p.posted_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
    expect(t).toContain('(p.posted_at, p.id) < (?::timestamp, ?::int)');
    expect(t).toContain('p.posted_at >= ?::timestamp');
    expect(t).not.toMatch(/timestamptz|AT TIME ZONE/i);
    expect(t).toContain("m.status = 'confirmed'");
    expect(calls[0]!.values).toEqual([1, '2026-10-01T00:00:00.000Z', false, '2026-10-30T12:00:00.123Z', 9, 21]);
  });
  it('cursor encode/decode is TZ-independent (process TZ=Asia/Shanghai)', () => {
    const prev = process.env.TZ; process.env.TZ = 'Asia/Shanghai';
    try {
      const c = { postedAt: '2026-10-30T23:59:59.999Z', postId: 5 };
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    } finally { process.env.TZ = prev; }
  });
});

const url = process.env.PG_TEST_URL;
describe.skipIf(!url)('real Postgres, session TimeZone = Asia/Shanghai', () => {
  const client = new pg.Client({ connectionString: url });
  // Same contract as Prisma $queryRaw: template strings + bound values ($1..$n)
  const db: CoreDb = { $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) =>
    (await client.query(strings.reduce((a, s, i) => a + '$' + i + s), values)).rows as never };
  beforeAll(async () => {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS m6_cursor_test CASCADE; CREATE SCHEMA m6_cursor_test; SET search_path = m6_cursor_test;
      CREATE TABLE platforms (id int PRIMARY KEY, name text);
      CREATE TABLE people (id int PRIMARY KEY, display_name text, handle text, platform_id int, kol_tier text);
      CREATE TABLE person_tags (id serial, person_id int, tag text);
      CREATE TABLE posts (id int PRIMARY KEY, person_id int, platform_id int, posted_at timestamp(3) NOT NULL, views int, bookmarks int, url text);
      CREATE TABLE post_mentions (id serial, post_id int, project_id int, match_method text, status text);
      INSERT INTO platforms VALUES (1, 'x'); INSERT INTO people VALUES (1, 'K', 'k', 1, 'A'); INSERT INTO person_tags (person_id, tag) VALUES (1, 'top_kol');`);
    const stamps = ['12:00:00.001', '12:00:00.002', '12:00:00.500', '12:00:00.500', '12:00:00.999', '12:00:00.999', '12:00:00.123', '11:59:59.999', '12:00:01.000'];
    for (const [i, t] of stamps.entries()) {
      await client.query(`INSERT INTO posts VALUES ($1::int, 1, 1, $2::timestamp, 1, 0, $3)`, [100 + i, `2026-10-30 ${t}`, `https://x.com/k/status/${100 + i}`]);
      await client.query(`INSERT INTO post_mentions (post_id, project_id, match_method, status) VALUES ($1, 7, 'ticker', 'confirmed')`, [100 + i]);
    }
    await client.query(`INSERT INTO posts VALUES (200, 1, 1, '2026-10-30 12:00:00.500', 1, 0, 'https://x.com/k/status/200');
      INSERT INTO post_mentions (post_id, project_id, match_method, status) VALUES (200, 7, 'ticker', 'pending')`);
    await client.query(`SET TimeZone = 'Asia/Shanghai'`);
    expect((await client.query('SHOW TimeZone')).rows[0].TimeZone).toBe('Asia/Shanghai');
  });
  afterAll(async () => { await client.query('DROP SCHEMA IF EXISTS m6_cursor_test CASCADE').catch(() => undefined); await client.end(); });

  it('pages of 2 terminate with no dups/gaps; postedAt is the stored UTC wall time at ms', async () => {
    const repo = new PgProjectRepository(db);
    const seen: { id: number; at: string }[] = []; let after: { postedAt: string; postId: number } | null = null;
    for (let page = 0; page < 20; page++) {
      const rows = await repo.getConfirmedPosts(7, '2026-10-24T00:00:00.000Z', after, 3);
      const pageRows = rows.slice(0, 2);
      seen.push(...pageRows.map((r) => ({ id: r.postId, at: r.postedAt })));
      if (rows.length <= 2) break;
      const last = pageRows[pageRows.length - 1]!;
      after = decodeCursor(encodeCursor({ postedAt: last.postedAt, postId: last.postId }));
      expect(after).not.toBeNull();
    }
    const ids = seen.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108]);
    expect(seen[0]).toEqual({ id: 108, at: '2026-10-30T12:00:01.000Z' });
    expect(seen.find((s) => s.id === 107)?.at).toBe('2026-10-30T11:59:59.999Z');
    expect(seen.map((s) => s.id)).toEqual([108, 105, 104, 103, 102, 106, 101, 100, 107]);
  });
});
