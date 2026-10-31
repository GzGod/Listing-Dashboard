import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { T } from '../../test-utils/index.js';
import { MockRankingsRepository } from '../../test-utils/index.js';
import { installTestErrorFormat } from '../../test-utils/http.js';
import plugin, { MemoryCache } from '../index.js';
import { loadM5ConfigFromBase } from '../../config.js';
import { dayStartUtcIso } from '../../lib/day.js';

/** 2026-10-30 17:00 UTC = 2026-10-31 01:00 Asia/Shanghai: the day cut differs between the two zones */
const now = () => new Date('2026-10-30T17:00:00Z');
const reader = (tz?: string) => ({ get: async <V = unknown>(key: string, d?: V) => (key === 'time.dayCutTimezone' && tz ? tz : d) as V });
async function run(tz: string | undefined, window: number) {
  const repo = new MockRankingsRepository();
  const calls: [string, string][] = [];
  const orig = repo.getSnapshots.bind(repo);
  repo.getSnapshots = (ids, from, to) => { calls.push([from, to]); return orig(ids, from, to); };
  const cache = new MemoryCache();
  const a = Fastify(); installTestErrorFormat(a);
  await a.register(plugin, { now, cache, config: await loadM5ConfigFromBase(reader(tz)), repo });
  const body = (await a.inject(`/rankings?track=${T.AI_AGENT}&window=${window}`)).json();
  return { body, calls, keys: [...(cache as unknown as { map: Map<string, unknown> }).map.keys()] };
}

describe('day cut from time.dayCutTimezone (via ctx.config)', () => {
  it('default (UTC): default date = 2026-10-29, 7d window 10-23..10-29', async () => {
    const { body, calls } = await run(undefined, 7);
    expect(body.date).toBe('2026-10-29'); expect(body.from).toBe('2026-10-23');
    expect(calls[0]).toEqual(['2026-10-23', '2026-10-29']);
  });
  it('Asia/Shanghai: default date shifts to 2026-10-30, 7d window 10-24..10-30, 30d from 10-01', async () => {
    const r7 = await run('Asia/Shanghai', 7);
    expect(r7.body.date).toBe('2026-10-30'); expect(r7.body.from).toBe('2026-10-24');
    expect(r7.calls[0]).toEqual(['2026-10-24', '2026-10-30']);
    expect(r7.keys.every((k) => k.startsWith('2026-10-30:'))).toBe(true); expect(r7.keys.length).toBeGreaterThan(0);
    const r30 = await run('Asia/Shanghai', 30);
    expect(r30.body.date).toBe('2026-10-30'); expect(r30.body.from).toBe('2026-10-01');
  });
  it('dayStartUtcIso converts the tz day start to UTC', () => {
    expect(dayStartUtcIso('2026-10-30', 'Asia/Shanghai')).toBe('2026-10-29T16:00:00.000Z');
    expect(dayStartUtcIso('2026-10-30', 'UTC')).toBe('2026-10-30T00:00:00.000Z');
    expect(dayStartUtcIso('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00.000Z');
  });
});
