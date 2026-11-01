import type { PrismaClient } from "@app/db";
import { CONFIG_DEFAULTS, configEnvName, type ConfigKey, type ConfigValue, type ScoreParams, type KolTierSet } from "@app/shared";

/** 配置中心：env(CONFIG_*) > system_config 表 > @app/shared 默认值。带 30 秒缓存（可用 CONFIG_CACHE_MS 调） */
/** 前端可读的底座配置键（不含任何密钥） */
export const PUBLIC_BASE_KEYS = ["time.dayCutTimezone", "ranking.windows", "ranking.defaultWindow"];
export class ConfigCenter {
  private cache = new Map<string, { v: unknown; at: number }>();
  private ttl = Number(process.env.CONFIG_CACHE_MS ?? 30000);
  private moduleDefaults: Record<string, unknown> = {};
  constructor(private db: PrismaClient) {}
  /** 合并各模块 manifest.config 里声明的键和默认值 */
  private publicKeys = new Set<string>(PUBLIC_BASE_KEYS);
  addModuleDefaults(defs: Record<string, unknown> | { key: string; default: unknown; public?: boolean }[]) {
    if (Array.isArray(defs)) for (const c of defs) { this.moduleDefaults[c.key] = c.default; if (c.public) this.publicKeys.add(c.key); }
    else Object.assign(this.moduleDefaults, defs);
    this.cache.clear();
  }
  /** 前端可读的配置（白名单：底座公开键 + 模块里 public: true 的键） */
  async publicConfig() { const out: Record<string, unknown> = {}; for (const k of this.publicKeys) out[k] = await this.get(k); return out; }
  private def(key: string) { return key in CONFIG_DEFAULTS ? (CONFIG_DEFAULTS as Record<string, unknown>)[key] : this.moduleDefaults[key]; }
  private fromEnv(key: string): unknown {
    const raw = process.env[configEnvName(key)]; if (raw === undefined || raw.trim() === "") return undefined;
    try { return JSON.parse(raw); } catch { return raw; }
  }
  async get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>;
  async get<T = unknown>(key: string, fallback?: T): Promise<T>;
  async get(key: string, fallback?: unknown): Promise<unknown> {
    const env = this.fromEnv(key); if (env !== undefined) return env;
    const c = this.cache.get(key); if (c && Date.now() - c.at < this.ttl) return c.v;
    let v: unknown;
    try { v = (await this.db.systemConfig.findUnique({ where: { key } }))?.value; } catch { v = undefined; }
    if (v === undefined || v === null) v = this.def(key) ?? fallback;
    this.cache.set(key, { v, at: Date.now() }); return v;
  }
  /** 同步读取（只看 env + 默认值），给启动阶段用 */
  getStatic<K extends ConfigKey>(key: K): ConfigValue<K> { return (this.fromEnv(key) ?? CONFIG_DEFAULTS[key]) as ConfigValue<K>; }
  async set(key: string, value: unknown, updatedBy?: number) {
    await this.db.systemConfig.upsert({ where: { key }, create: { key, value: value as any, updatedBy }, update: { value: value as any, updatedBy } });
    this.cache.delete(key);
  }
  async all() {
    const rows = await this.db.systemConfig.findMany();
    const db = new Map(rows.map((r) => [r.key, r.value]));
    const keys = new Set([...Object.keys(CONFIG_DEFAULTS), ...Object.keys(this.moduleDefaults), ...db.keys()]);
    return [...keys].sort().map((key) => {
      const env = this.fromEnv(key);
      return { key, default: this.def(key), db: db.get(key), env, effective: env ?? db.get(key) ?? this.def(key), envName: configEnvName(key) };
    });
  }
  /** 某天（UTC YYYY-MM-DD，默认今天）生效的 score_params 版本：effective_from <= 该日的最新一版 */
  async scoreParams(date?: string): Promise<ScoreParams | null> {
    const d = date ? new Date(date + "T00:00:00Z") : new Date();
    const p = await this.db.scoreParams.findFirst({ where: { effectiveFrom: { lte: d } }, orderBy: { effectiveFrom: "desc" } });
    return p && { ...p, effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10), updatedAt: p.updatedAt.toISOString() };
  }
  /** 某天（UTC YYYY-MM-DD，默认今天）生效的 KOL 等级权重版本 */
  async kolTiers(date?: string): Promise<KolTierSet | null> {
    const d = date ? new Date(date + "T00:00:00Z") : new Date();
    const head = await this.db.kolTier.findFirst({ where: { effectiveFrom: { lte: d } }, orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }] });
    if (!head) return null;
    const rows = await this.db.kolTier.findMany({ where: { version: head.version } });
    return { version: head.version, effectiveFrom: head.effectiveFrom.toISOString().slice(0, 10), weights: Object.fromEntries(rows.map((r) => [r.name, r.weight])) };
  }
}
