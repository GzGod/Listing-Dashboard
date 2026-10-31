import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import semver from "semver";
import { checkWrites } from "./ownership.js";
import { CONFIG_DEFAULTS } from "@app/shared";
import { CORE_VERSION, MANIFEST_API_VERSION, type ModuleManifest, type ModuleRecord } from "./types.js";

const NAME_RE = /^[a-z][a-z0-9-]*$/;
export const tablePrefix = (name: string) => `m_${name.replace(/-/g, "_")}_`;
const expandEnv = (s: string) => s.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, k, d) => process.env[k] ?? d ?? "");

/** 扫描 modules/：每个子目录有 module.manifest.ts（代码内模块）或 module.manifest.json（外部服务模块） */
export async function discoverModules(root: string, disabled: string[] = []): Promise<ModuleRecord[]> {
  const out: ModuleRecord[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root).sort()) {
    const dir = path.join(root, entry);
    if (!fs.statSync(dir).isDirectory() || entry.startsWith(".") || entry.startsWith("_")) continue;
    try {
      const m = await readManifest(dir);
      if (!m) continue;
      out.push({ manifest: m, dir, status: disabled.includes(m.name) ? "skipped" : "loaded", error: disabled.includes(m.name) ? "被 DISABLED_MODULES 停用" : undefined });
    } catch (e) {
      out.push({ manifest: { apiVersion: 1, name: entry, version: "0.0.0" }, dir, status: "failed", error: `manifest 读取失败: ${(e as Error).message}` });
    }
  }
  return out;
}

export async function readManifest(dir: string): Promise<ModuleManifest | null> {
  for (const f of ["module.manifest.ts", "module.manifest.js", "module.manifest.mjs"]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) { const mod = await import(pathToFileURL(p).href); return (mod.default ?? mod.manifest) as ModuleManifest; }
  }
  const j = path.join(dir, "module.manifest.json");
  if (fs.existsSync(j)) {
    const m = JSON.parse(fs.readFileSync(j, "utf8")) as ModuleManifest;
    m.kind ??= "external";
    if (m.external?.baseUrl) m.external.baseUrl = expandEnv(m.external.baseUrl);
    return m;
  }
  return null;
}

/** 读取模块迁移 SQL（按文件名排序） */
export function readMigrations(r: ModuleRecord): { name: string; sql: string }[] {
  const dir = path.join(r.dir, r.manifest.migrations ?? "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}
const DDL_RE = /\b(?:create|alter|drop)\s+(?:table|index\s+(?:if\s+not\s+exists\s+)?\S+\s+on)\s+(?:if\s+(?:not\s+)?exists\s+)?"?([a-zA-Z0-9_]+)"?/gi;
export function tablesTouchedByDDL(sql: string) { return [...sql.matchAll(DDL_RE)].map((m) => m[1].toLowerCase()); }

export function validate(m: ModuleManifest, r?: ModuleRecord): string | null {
  if (!m || typeof m !== "object") return "manifest 没有默认导出";
  if (m.apiVersion !== MANIFEST_API_VERSION) return `apiVersion=${m.apiVersion}，底座只支持 apiVersion: ${MANIFEST_API_VERSION}`;
  if (!m.name || !NAME_RE.test(m.name)) return `name "${m?.name}" 不合法，只能用小写字母开头的小写字母/数字/短横线`;
  if (!m.version || !semver.valid(m.version)) return `version "${m.version}" 不是合法的语义化版本`;
  if (m.requires?.core && !semver.satisfies(CORE_VERSION, m.requires.core)) return `需要底座 ${m.requires.core}，当前底座是 ${CORE_VERSION}`;
  if (m.kind === "external" && !m.external?.baseUrl) return "外部服务模块必须填 external.baseUrl";
  const pre = tablePrefix(m.name);
  for (const t of m.tables?.owns ?? []) if (!t.startsWith(pre)) return `自有表 ${t} 必须以 ${pre} 开头`;
  if (m.config !== undefined && !Array.isArray(m.config)) return "config 必须是数组 [{ key, default, description?, public? }]";
  const seenKeys = new Set<string>();
  for (const c of m.config ?? []) {
    if (!c || typeof c.key !== "string" || !("default" in c)) return "config 每一项都要有 key 和 default";
    if (!c.key.startsWith(m.name + ".")) return `配置键 ${c.key} 必须以 "${m.name}." 开头`;
    if (c.key in CONFIG_DEFAULTS) return `配置键 ${c.key} 和底座配置重复`;
    if (seenKeys.has(c.key)) return `配置键 ${c.key} 重复声明`; seenKeys.add(c.key);
  }
  for (const j of m.jobs ?? []) if (j.cronKey && !seenKeys.has(j.cronKey)) return `任务 ${j.name} 的 cronKey ${j.cronKey} 没有在 manifest.config 里声明`;
  const wErr = checkWrites(m.name, m.tables?.writes ?? [], pre); if (wErr) return wErr;
  if (r) for (const mig of readMigrations(r)) for (const t of tablesTouchedByDDL(mig.sql))
    if (!t.startsWith(pre)) return `迁移 ${mig.name} 动了非自有表 ${t}（只能建/改 ${pre}* 表）`;
  return null;
}

/** 校验 + 按依赖拓扑排序。坏模块标 failed，依赖它的标 skipped，其他照常 */
export function resolveOrder(records: ModuleRecord[]): ModuleRecord[] {
  const byName = new Map<string, ModuleRecord>();
  for (const r of records) {
    if (r.status === "loaded") {
      const err = byName.has(r.manifest.name) ? `name "${r.manifest.name}" 与其他模块重复` : validate(r.manifest, r);
      if (err) { r.status = "failed"; r.error = err; }
    }
    if (!byName.has(r.manifest.name)) byName.set(r.manifest.name, r);
  }
  // 配置键冲突：两个模块声明同一个键（正常情况下前缀规则已能避免）
  const owner = new Map<string, string>();
  for (const r of records) if (r.status === "loaded") for (const k of (r.manifest.config ?? []).map((c) => c.key)) {
    if (owner.has(k)) { r.status = "failed"; r.error = `配置键 ${k} 已被模块 ${owner.get(k)} 声明`; } else owner.set(k, r.manifest.name);
  }
  const ordered: ModuleRecord[] = [];
  const state = new Map<ModuleRecord, "visiting" | "done">();
  const visit = (r: ModuleRecord, chain: string[]): boolean => {
    if (state.get(r) === "done") return r.status === "loaded";
    if (state.get(r) === "visiting") { r.status = "failed"; r.error = `循环依赖: ${[...chain, r.manifest.name].join(" -> ")}`; return false; }
    state.set(r, "visiting");
    if (r.status === "loaded") for (const dep of r.manifest.dependsOn ?? []) {
      const d = byName.get(dep);
      if (!d) { r.status = "skipped"; r.error = `缺少依赖模块 ${dep}`; break; }
      if (!visit(d, [...chain, r.manifest.name])) { if (r.status === "loaded") { r.status = "skipped"; r.error = `依赖 ${dep} 不可用`; } break; }
    }
    state.set(r, "done"); ordered.push(r);
    return r.status === "loaded";
  };
  for (const r of records) visit(r, []);
  return ordered;
}
