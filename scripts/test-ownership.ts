// pnpm test:ownership —— 校验核心表写入作用域（需要数据库）
import { getPrisma } from "@app/db";
import { makeModuleDb, checkWrites, sql, join, writeTargets, isSingleReadQuery } from "@app/core";
const db = getPrisma(); let bad = 0;
const t = async (name: string, fn: () => Promise<unknown>, shouldPass: boolean) => {
  let ok = true, msg = ""; try { await fn(); } catch (e) { ok = false; msg = (e as Error).message; }
  const pass = ok === shouldPass; if (!pass) bad++; console.log(`${pass ? "✅" : "❌"} ${name}${msg ? "  -> " + msg.slice(0, 90) : ""}`);
};
const ex = makeModuleDb(db, "example", []);
const m4 = makeModuleDb(db, "m4-admin", ["buzz_adjustments", "projects"]);
const m3 = makeModuleDb(db, "m3-engine", ["buzz_snapshots", "project_daily"]);
const b = (await db.buzzSnapshot.findFirst())!;
await t("example 读核心表 projects", () => ex.core.project.count(), true);
await t("example 写核心表 projects 被拦截", () => ex.core.project.update({ where: { id: 1 }, data: { name: "x" } }), false);
await t("example 用 SQL 写核心表被拦截", () => ex.query(`UPDATE projects SET name = 'x' WHERE id = 1`), false);
await t("example 写审计日志表被拦截", () => ex.core.auditLog.create({ data: { module: "example", action: "x" } }), false);
await t("m4-admin 写 buzz_adjustments（人工调分）", () => m4.core.buzzAdjustment.create({ data: { projectId: b.projectId, day: b.day, buzzSnapshotId: b.id, value: 999, reason: "test", createdBy: 1 } }), true);
await t("m4-admin 直接改 buzz_snapshots 被拦截", () => m4.core.buzzSnapshot.update({ where: { id: b.id }, data: { rawTotal: 1 } }), false);
await t("m3-engine 写 adjusted_total", () => m3.core.buzzSnapshot.update({ where: { id: b.id }, data: { adjustedTotal: 999 } }), true);
await t("m3-engine 写 buzz_adjustments 被拦截", () => m3.core.buzzAdjustment.create({ data: { projectId: b.projectId, day: b.day, value: 1 } }), false);
await t("example SQL 改核心表结构被拦截", () => ex.query(`ALTER TABLE projects ADD COLUMN x int`), false);
await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS m_example_kv (k text PRIMARY KEY, v text)`);
await t("自有表 INSERT ... ON CONFLICT DO UPDATE SET 放行", () => ex.query(`INSERT INTO m_example_kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, "a", "1"), true);
await t("自有表 ON CONFLICT DO NOTHING 放行", () => ex.query(`INSERT INTO m_example_kv (k, v) VALUES ($1, $2) ON CONFLICT DO NOTHING`, "a", "2"), true);
await t("WITH ... INSERT 自有表放行", () => ex.query(`WITH s AS (SELECT 'b'::text AS k) INSERT INTO m_example_kv (k, v) SELECT k, 'x' FROM s ON CONFLICT (k) DO UPDATE SET v = 'y'`), true);
await t("m3 upsert 整表归属的 project_daily 放行（解析层）", async () => { const w = writeTargets(`INSERT INTO project_daily (project_id) VALUES (1) ON CONFLICT (project_id, day) DO UPDATE SET volume_track_rank = NULL`); if (w.join() !== "project_daily") throw new Error(w.join()); }, true);
await t("WITH 里 DELETE 核心表被拦截", () => ex.query(`WITH d AS (DELETE FROM projects WHERE false RETURNING id) INSERT INTO m_example_kv (k) SELECT id::text FROM d`), false);
await db.$executeRawUnsafe(`DROP TABLE m_example_kv`);
await t("example 写别的模块表被拦截", () => ex.query(`INSERT INTO m_py_example_items (title) VALUES ('x')`), false);
await t("同一项目同一天第二条未撤销调整被唯一索引拒绝", () => m4.core.buzzAdjustment.create({ data: { projectId: b.projectId, day: b.day, value: 1, reason: "test" } }), false);
await t("模块用模板 $queryRaw 只读查询", () => ex.core.$queryRaw`SELECT count(*)::int AS c FROM projects WHERE id > ${0}`, true);
await t("模块用 $queryRaw(sql`...`) + join 只读查询", () => ex.core.$queryRaw(sql`SELECT id FROM projects WHERE id IN (${join([1, 2])})`), true);
await t("模块用 $queryRaw(sql`UPDATE`) 被拦截", () => ex.core.$queryRaw(sql`UPDATE projects SET name = ${"x"} WHERE id = 1`), false);
await t("模块用 $queryRaw 写入被拦截", () => ex.core.$queryRaw`UPDATE projects SET name = ${"x"} WHERE id = 1`, false);
await t("模块用 $queryRawUnsafe 被拦截", () => (ex.core as any).$queryRawUnsafe("SELECT 1"), false);
await t("模块用 $executeRaw 被拦截", () => (ex.core as any).$executeRaw`DELETE FROM projects`, false);
await t("模块用 $executeRawUnsafe 被拦截", () => (ex.core as any).$executeRawUnsafe("DELETE FROM projects"), false);
await db.buzzAdjustment.updateMany({ where: { reason: "test" }, data: { revoked: true } });
await t("撤销后可以再加一条", () => m4.core.buzzAdjustment.create({ data: { projectId: b.projectId, day: b.day, value: 2, reason: "test" } }), true);
await db.buzzAdjustment.deleteMany({ where: { reason: "test" } }); await db.buzzSnapshot.update({ where: { id: b.id }, data: { adjustedTotal: b.adjustedTotal } });
for (const [n, w, ok] of [["m4-admin", ["buzz_adjustments"], true], ["m4-admin", ["buzz_snapshots"], false], ["m3-engine", ["buzz_snapshots", "project_daily"], true], ["m4-admin", ["projects.name"], false], ["example", ["projects"], false], ["m1-collector", ["posts", "volume_snapshots"], true], ["example", ["audit_logs"], false], ["m4-admin", ["users"], false]] as const) {
  const err = checkWrites(n, [...w], `m_${n.replace(/-/g, "_")}_`); const pass = !err === ok; if (!pass) bad++;
  console.log(`${pass ? "✅" : "❌"} pnpm check: ${n} writes ${w.join(",")} -> ${err ?? "允许"}`);
}
await db.$disconnect(); // 赛道外键 onDelete: Restrict：被 projects / buzz_snapshots / project_daily 引用的赛道删不掉（历史保留），没被引用的能删
{
  const day = new Date("2020-01-01T00:00:00Z");
  const tryDel = async (id: number) => { try { await db.track.delete({ where: { id } }); return ""; } catch (e) { return (e as any).code + " " + (e as Error).message.split("\n").filter(Boolean).pop(); } };
  for (const via of ["projects", "buzz_snapshots", "project_daily"] as const) {
    const tr = await db.track.create({ data: { name: `tmp-restrict-${via}` } });
    const pj = await db.project.create({ data: { name: `tmp-restrict-${via}`, symbol: "TMPR", trackId: via === "projects" ? tr.id : null } });
    if (via === "buzz_snapshots") await db.buzzSnapshot.create({ data: { projectId: pj.id, day, trackId: tr.id, adjustedTotal: 1 } });
    if (via === "project_daily") await db.projectDaily.create({ data: { projectId: pj.id, day, trackId: tr.id } });
    const err = await tryDel(tr.id);
    const okk = /P2003|foreign key/i.test(err); if (!okk) bad++;
    console.log(`${okk ? "✅" : "❌"} 被 ${via} 引用的赛道删除失败（外键错误） -> ${err.slice(0, 90)}`);
    await db.project.delete({ where: { id: pj.id } }); // 级联删快照
    const err2 = await tryDel(tr.id); if (err2) bad++; console.log(`${err2 ? "❌" : "✅"} 引用清掉后删除成功 ${err2}`);
  }
  const unused = await db.track.create({ data: { name: "tmp-unused" } });
  const e3 = await tryDel(unused.id); if (e3) bad++; console.log(`${e3 ? "❌" : "✅"} 没被引用的赛道可以删 ${e3}`);
}
// $queryRaw 只读守卫：注释/字符串里的分号不算多语句
await t("$queryRaw：-- 注释里有分号也放行", () => ex.core.$queryRaw(sql`SELECT 1 AS a -- note; DELETE FROM projects
`), true);
await t("$queryRaw：/* */ 注释里有分号也放行", () => ex.core.$queryRaw(sql`SELECT /* a; b */ 1 AS a`), true);
await t("$queryRaw：字符串里有分号也放行", () => ex.core.$queryRaw(sql`SELECT 'a;b' AS s, ${"x;y"}::text AS p`), true);
await t("$queryRaw：末尾单独一个分号放行", () => ex.core.$queryRaw(sql`SELECT 1 AS a;`), true);
await t("$queryRaw：SELECT 1; DELETE ... 被拦截", () => ex.core.$queryRaw(sql`SELECT 1; DELETE FROM projects WHERE false`), false);
await t("$queryRaw：注释后藏第二条语句被拦截", () => ex.core.$queryRaw(sql`SELECT 1 /* x */; UPDATE projects SET name = name WHERE false`), false);
{ const c: [string, boolean][] = [["WITH x AS (SELECT 1) SELECT * FROM x", true], ["  -- lead\nSELECT 1", true], ["DELETE FROM projects", false]];
  for (const [q, e] of c) { const g = isSingleReadQuery(q); if (g !== e) bad++; console.log(`${g === e ? "✅" : "❌"} isSingleReadQuery(${JSON.stringify(q)}) = ${g}`); } }
// SQL 写目标解析
const wt = (q: string, exp: string[]) => { const got = writeTargets(q); const okk = JSON.stringify(got) === JSON.stringify(exp); if (!okk) bad++; console.log(`${okk ? "✅" : "❌"} writeTargets: ${q.replace(/\s+/g, " ").slice(0, 70)} -> ${JSON.stringify(got)}`); };
wt("INSERT INTO m_example_notes (id, text) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text", ["m_example_notes"]);
wt("insert into m_example_notes (id) values (1) on conflict do nothing", ["m_example_notes"]);
wt("UPDATE m_example_notes SET text = $1 WHERE id = $2", ["m_example_notes"]);
wt("UPDATE ONLY public.\"m_example_notes\" SET text = 'x'", ["m_example_notes"]);
wt("WITH x AS (SELECT 1) INSERT INTO m_example_notes (text) SELECT 'a' FROM x ON CONFLICT (id)\n  DO   UPDATE\n SET text='b'", ["m_example_notes"]);
wt("WITH d AS (DELETE FROM projects RETURNING id) INSERT INTO m_example_notes (text) SELECT id::text FROM d", ["projects", "m_example_notes"]);
wt("SELECT * FROM projects FOR UPDATE", []);
wt("SELECT * FROM projects FOR NO KEY UPDATE", []);
wt("SELECT 'update projects set x=1' AS s -- delete from users", []);
console.log(bad ? `${bad} 项失败` : "全部通过"); process.exit(bad ? 1 : 0);
