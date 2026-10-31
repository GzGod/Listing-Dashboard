import type { DailyBatchDoneEvent, EventMap } from '@app/shared';
import type { ModuleContext } from '@app/core';
const DAILY_BATCH_DONE = 'daily.batch.done' satisfies keyof EventMap;

/**
 * Rankings cache. Key (inside the base's auto prefix `m:m5-rankings:` of ctx.redis) = `${date}:${track}:${window}` —
 * date first. A ranking for date D only depends on days <= D, so a recalculation from `dateFrom` invalidates exactly
 * the keys with date >= dateFrom. We add NO module prefix ourselves (ctx.redis does).
 */
export interface RankingsCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  /** delete this module's cache keys whose date >= dateFrom (all if dateFrom is missing) */
  invalidateFrom(dateFrom?: string): Promise<number>;
}
export const cacheKey = (date: string, track: string, window: number) => `${date}:${track}:${window}`;
const KEY_RE = /^\d{4}-\d{2}-\d{2}:/;
const isOurs = (k: string, dateFrom?: string) => KEY_RE.test(k) && (!dateFrom || k.slice(0, 10) >= dateFrom);

/** subset of base ctx.redis we use (ioredis client with options.keyPrefix = "m:<moduleId>:", see base core/src/redis.ts); typed from ModuleContext, no ioredis import */
export type PrefixedRedis = Pick<ModuleContext['redis'], 'get' | 'set' | 'del' | 'scan'> & { options: { keyPrefix?: string } };

/**
 * Redis implementation over ctx.redis (shared across instances).
 * ioredis applies keyPrefix to GET/SET/DEL but NOT to SCAN's MATCH pattern nor to the keys SCAN returns,
 * so invalidation scans `${keyPrefix}*` explicitly and strips the prefix before DEL (which re-adds it).
 */
export class RedisRankingsCache implements RankingsCache {
  constructor(private redis: PrefixedRedis) {}
  async get<T>(key: string) { const v = await this.redis.get(key); return v === null ? undefined : (JSON.parse(v) as T); }
  async set<T>(key: string, value: T, ttlMs: number) { await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs); }
  async invalidateFrom(dateFrom?: string) {
    const prefix = this.redis.options.keyPrefix ?? '';
    let cursor = '0'; let n = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      const del = keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).filter((k) => isOurs(k, dateFrom));
      if (del.length) n += await this.redis.del(...del);
    } while (cursor !== '0');
    return n;
  }
}

/** In-process implementation for the dev harness / single instance only. */
export class MemoryCache implements RankingsCache {
  private map = new Map<string, { v: unknown; exp: number }>();
  constructor(private now: () => number = Date.now) {}
  async get<T>(key: string) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp < this.now()) { this.map.delete(key); return undefined; }
    return e.v as T;
  }
  async set<T>(key: string, value: T, ttlMs: number) { this.map.set(key, { v: value, exp: this.now() + ttlMs }); }
  async invalidateFrom(dateFrom?: string) {
    let n = 0;
    for (const k of [...this.map.keys()]) if (isOurs(k, dateFrom)) { this.map.delete(k); n++; }
    return n;
  }
  get size() { return this.map.size; }
}

/** base DailyBatchDoneEvent (EventMap['daily.batch.done']), exactly { dateFrom, dateTo } */
export type DailyBatchDonePayload = DailyBatchDoneEvent;
export function createDailyBatchDoneHandler(cache: RankingsCache, log?: (msg: string) => void) {
  return async (payload?: DailyBatchDonePayload) => {
    const invalidated = await cache.invalidateFrom(payload?.dateFrom);
    log?.(`${DAILY_BATCH_DONE} ${payload?.dateFrom ?? '*'}~${payload?.dateTo ?? '*'}: cleared ${invalidated} keys`);
    return { event: DAILY_BATCH_DONE, invalidated };
  };
}
