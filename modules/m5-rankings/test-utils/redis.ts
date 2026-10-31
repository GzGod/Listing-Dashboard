/**
 * TEST ONLY: in-memory stand-in for base ctx.redis with the SAME prefix semantics as the official package
 * (core/src/redis.ts: ioredis `keyPrefix: "m:<module>:"`): GET/SET/DEL prepend the prefix; SCAN does NOT prefix the
 * MATCH pattern and returns full (prefixed) keys. No ioredis / ioredis-mock involved.
 */
export interface FakeRedisServer { data: Map<string, { v: string; exp: number }> }
export const makeFakeRedisServer = (): FakeRedisServer => ({ data: new Map() });

const globToRe = (p: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

export function makeFakeModuleRedis(server: FakeRedisServer, moduleId = 'm5-rankings', opts: { failing?: boolean } = {}) {
  const prefix = `m:${moduleId}:`;
  const fail = () => Promise.reject(new Error('Connection is closed.'));
  const live = (k: string) => { const e = server.data.get(k); if (e && e.exp < Date.now()) { server.data.delete(k); return undefined; } return e; };
  return {
    options: { keyPrefix: prefix },
    async get(key: string) { if (opts.failing) return fail(); return live(prefix + key)?.v ?? null; },
    async set(key: string, value: string, _px: 'PX', ttlMs: number) { if (opts.failing) return fail(); server.data.set(prefix + key, { v: value, exp: Date.now() + ttlMs }); return 'OK'; },
    async del(...keys: string[]) { if (opts.failing) return fail(); let n = 0; for (const k of keys) if (server.data.delete(prefix + k)) n++; return n; },
    async scan(cursor: string, _m: 'MATCH', pattern: string, _c: 'COUNT', count: number): Promise<[string, string[]]> {
      if (opts.failing) return fail();
      const all = [...server.data.keys()].filter((k) => globToRe(pattern).test(k)); // pattern NOT prefixed, keys returned with prefix
      const start = Number(cursor); const page = all.slice(start, start + count);
      return [start + count >= all.length ? '0' : String(start + count), page];
    },
  };
}
