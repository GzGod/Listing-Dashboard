import { Redis } from "ioredis";
/** 给单个模块的 Redis 连接（每个模块一条，不共用）：来自核心 REDIS_URL，key 自动加 m:<模块名>: 前缀（ioredis keyPrefix）。
 *  Redis 不可用时命令很快失败（reject），只影响调用它的模块，不会让进程崩。 */
export function makeModuleRedis(name: string, log: { warn: (...a: any[]) => void }, url = process.env.REDIS_URL ?? "redis://localhost:6379"): Redis {
  const c = new Redis(url, { keyPrefix: `m:${name}:`, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: (n) => Math.min(n * 500, 5000) });
  let warned = false;
  c.on("error", (e) => { if (!warned) { warned = true; log.warn("Redis 连接出错（只影响本模块 ctx.redis）", e.message); } });
  c.on("ready", () => { warned = false; });
  return c;
}
