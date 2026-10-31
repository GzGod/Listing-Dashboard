import { Prisma, type PrismaClient } from "@app/db";
import type { ModuleDb, ModuleRecord } from "./types.js";
import { readMigrations, tablePrefix } from "./loader.js";
import { BASE_ONLY_TABLES } from "./ownership.js";
import type { Logger } from "./logger.js";

// 写语句里的目标表。排除 ON CONFLICT ... DO UPDATE SET（目标就是 INSERT 的表）和 SELECT ... FOR UPDATE / FOR NO KEY UPDATE；支持 ONLY、schema 前缀
const WRITE_RE = /(?<!\bdo\s+)(?<!\bfor\s+(?:no\s+key\s+)?)\b(?:insert\s+into|update(?:\s+only)?|delete\s+from(?:\s+only)?|truncate(?:\s+table)?(?:\s+only)?|alter\s+table(?:\s+if\s+exists)?(?:\s+only)?|drop\s+table(?:\s+if\s+exists)?|create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table(?:\s+if\s+not\s+exists)?)\s+(?:"?[a-zA-Z0-9_]+"?\s*\.\s*)?"?([a-zA-Z0-9_]+)"?/gi;
/** 去掉字符串字面量和注释，避免把 '...update x...' 这种文本当成写语句 */
// 单遍扫描：字符串、行注释、块注释谁先出现按谁处理（注释里的引号、字符串里的 -- 都不会误判）
const stripSql = (s: string) => s.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === "'" ? "''" : " "));
const READ_RE = /^\s*(select|with)\b/i;
/** 导出给测试用：SQL 里会被写的表名（小写） */
export function writeTargets(sql: string): string[] { return [...stripSql(sql).matchAll(WRITE_RE)].map((m) => m[1].toLowerCase()); }
const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
// Prisma 模型名 -> { 表名, 字段名 -> 列名 }
const MODEL_MAP = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, { table: m.dbName ?? m.name, cols: new Map(m.fields.map((f) => [f.name, f.dbName ?? f.name])) }]));

export function makeModuleDb(db: PrismaClient, name: string, writes: string[] = []): ModuleDb {
  const pre = tablePrefix(name);
  const whole = new Set(writes.filter((w) => !w.includes(".")));
  const cols = new Map<string, Set<string>>();
  for (const w of writes) if (w.includes(".")) { const [t, c] = w.split("."); cols.set(t, (cols.get(t) ?? new Set()).add(c)); }
  const deny = (t: string, why = "") => { throw new Error(`模块 ${name} 无权写核心表 ${t}${why}。任何核心表都能读；写入只限 manifest.tables.writes 里声明且归本模块所有的表/列`); };
  // 核心表写入作用域：按整表（列级逻辑保留为通用能力，tables.writes 目前只允许整表）
  const scoped = db.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    if (WRITE_OPS.has(operation)) {
      const meta = MODEL_MAP.get(model)!;
      if (BASE_ONLY_TABLES.includes(meta.table)) deny(meta.table, "（审计日志请用 ctx.audit）");
      if (!whole.has(meta.table)) {
        const allowed = cols.get(meta.table);
        if (!allowed) deny(meta.table);
        if (operation.startsWith("delete")) deny(meta.table, "（列级权限不能删行）");
        const datas = [(args as any).data, (args as any).create, (args as any).update].flatMap((d) => (Array.isArray(d) ? d : d ? [d] : []));
        for (const d of datas) for (const k of Object.keys(d)) { const c = meta.cols.get(k) ?? k; if (!allowed!.has(c)) deny(`${meta.table}.${c}`); }
      }
    }
    return query(args);
  } } } });
  // 原生 SQL：模块只能用带参数绑定的模板字符串 $queryRaw 做只读查询；$queryRawUnsafe / $executeRaw / $executeRawUnsafe 一律禁止
  const coreScoped = new Proxy(scoped as any, {
    get(target, prop, recv) {
      if (prop === "$queryRawUnsafe" || prop === "$executeRaw" || prop === "$executeRawUnsafe")
        return () => { throw new Error(`模块 ${name} 不能用 ${String(prop)}：原生 SQL 只允许模板字符串 $queryRaw 只读查询；写自有表用 ctx.db.query，写核心表用 Prisma 模型方法`); };
      if (prop === "$queryRaw") return (strings: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
        // 允许两种参数绑定写法：$queryRaw`...${x}` 或 $queryRaw(sql`...${x}`)（sql 来自 @app/core，即 Prisma.sql）
        let sql: string;
        if (isSqlFragment(strings)) sql = strings.sql;
        else if (Array.isArray(strings) && "raw" in strings) sql = strings.join("?");
        else throw new Error("$queryRaw 只能用模板字符串 $queryRaw`...` 或 $queryRaw(sql`...`)，不能传拼好的字符串");
        if (!isSingleReadQuery(sql)) throw new Error(`模块 ${name} 的 $queryRaw 只能是单条 SELECT/WITH 只读查询`);
        return isSqlFragment(strings) ? target.$queryRaw(strings) : target.$queryRaw(strings, ...values);
      };
      return Reflect.get(target, prop, recv);
    },
  }) as unknown as PrismaClient;
  return {
    core: coreScoped,
    t: (s) => pre + s,
    async query(sql, ...params) {
      for (const m of stripSql(sql).matchAll(WRITE_RE)) {
        const t = m[1].toLowerCase();
        if (t.startsWith(pre)) continue;
        if (/^\s*(alter|drop|create|truncate)/i.test(m[0])) throw new Error(`模块 ${name} 不能改核心表/别的模块表结构：${t}`);
        if (!whole.has(t)) throw new Error(`模块 ${name} 不能用 SQL 写 ${t}：只能写 ${pre}* 自有表和整表归属于本模块的核心表`);
      }
      return (await db.$queryRawUnsafe(sql, ...params)) as any[];
    },
  };
}

/** 安装：按文件名顺序执行模块迁移，记录在 _module_migrations（幂等） */
// 只有 server 跑迁移；每条迁移在事务里先拿 pg_advisory_xact_lock，再复查是否已做，多个 server 同时启动也只会执行一次
const MIGRATION_LOCK_KEY = 727001;
export async function applyModuleMigrations(db: PrismaClient, r: ModuleRecord, log: Logger) {
  for (const mig of readMigrations(r)) {
    const ran = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);
      if (await tx.moduleMigration.findFirst({ where: { module: r.manifest.name, name: mig.name } })) return false;
      for (const stmt of mig.sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(stmt);
      await tx.moduleMigration.create({ data: { module: r.manifest.name, name: mig.name } });
      return true;
    }, { timeout: 120000 });
    if (ran) log.info(`迁移已执行 ${r.manifest.name}/${mig.name}`);
  }
}

/** worker：不跑迁移，轮询 _module_migrations 直到本模块所有迁移都被 server 执行完；超时抛错（该模块标记 failed） */
export async function waitModuleMigrations(db: PrismaClient, r: ModuleRecord, timeoutMs: number, pollMs: number) {
  const want = readMigrations(r).map((m) => m.name);
  if (!want.length) return;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const done = new Set((await db.moduleMigration.findMany({ where: { module: r.manifest.name } })).map((x) => x.name));
    const missing = want.filter((n) => !done.has(n));
    if (!missing.length) return;
    if (Date.now() > until) throw new Error(`等待 server 执行迁移超时（${timeoutMs}ms），缺：${missing.join(", ")}`);
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/** 卸载：只删 m_<name>_ 前缀的表和迁移记录，绝不碰核心表 */
export async function dropModuleTables(db: PrismaClient, name: string) {
  const pre = tablePrefix(name);
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE $1`, pre.replace(/_/g, "\\_") + "%");
  for (const { tablename } of rows) await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
  await db.moduleMigration.deleteMany({ where: { module: name } });
  return rows.map((r) => r.tablename);
}

/** Prisma.sql`...` 生成的片段（运行时没有可 instanceof 的类，按形状判断） */
function isSqlFragment(x: unknown): x is Prisma.Sql {
  return !!x && typeof x === "object" && !Array.isArray(x) && typeof (x as { sql?: unknown }).sql === "string" && Array.isArray((x as { values?: unknown }).values);
}

/** 只读检查：先去掉 -- / 块注释和单引号字符串（里面的分号不算），再判断是不是单条 SELECT/WITH；末尾单独一个分号允许 */
export function isSingleReadQuery(sql: string): boolean {
  const s = stripSql(sql).trim();
  return READ_RE.test(s) && !/;\s*\S/.test(s);
}
