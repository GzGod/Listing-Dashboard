// 核心表写入归属表（提议稿，待技术评审确认）。
// 规则：任何模块都可以读任何核心表；只能写自己拥有的核心表（或列）；任何模块都不能改核心表结构，也不能碰别的模块的 m_<module>_ 表。
// 写在 manifest.tables.writes 里的核心表必须在这里归属于该模块，否则 pnpm check 失败、运行时写入被拦截。
// 条目写法：只按整表（"table"），不做列级归属。审计日志 audit_logs 只能通过 ctx.audit 写（底座）。
export const CORE_WRITE_OWNERSHIP: Record<string, string[]> = {
  "m1-collector": ["posts", "volume_snapshots", "price_snapshots"],
  "m2-matcher": ["post_mentions"],
  "m3-engine": ["buzz_snapshots", "project_daily"], // 整表，含 track_rank / volume_track_rank
  "m4-admin": [
    "buzz_adjustments",
    "projects", "project_contracts", "project_aliases", "listing_events", "tracks", "people", "person_tags",
    "score_params", "system_config", "exchanges", "platforms", "kol_tiers",
  ],
};
export const BASE_ONLY_TABLES = ["audit_logs", "users", "_module_migrations"]; // users 只能通过底座 /api/_core/users 写
/** 校验 manifest.tables.writes：只能是自有表或归属给本模块的核心表/列 */
export function checkWrites(name: string, writes: string[], prefix: string): string | null {
  const owned = new Set(CORE_WRITE_OWNERSHIP[name] ?? []);
  for (const w of writes) {
    if (w.includes(".")) return `tables.writes 只按整表声明，不支持列级：${w}`;
    if (w.startsWith("m_")) { if (!w.startsWith(prefix)) return `writes 里的 ${w} 是别的模块的表（自有表前缀 ${prefix}）`; continue; }
    if (BASE_ONLY_TABLES.includes(w.split(".")[0])) return `${w} 只能由底座写（审计用 ctx.audit）`;
    if (owned.has(w)) continue;
    if (!w.includes(".") && [...owned].some((o) => o.startsWith(w + "."))) return `${w} 只能写部分列：${[...owned].filter((o) => o.startsWith(w + ".")).join(", ")}`;
    return `${name} 不拥有核心表 ${w}（见 packages/core/src/ownership.ts 写入归属表）`;
  }
  return null;
}
