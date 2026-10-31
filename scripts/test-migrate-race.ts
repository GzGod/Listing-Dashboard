// pnpm test:migrate-race —— 同时启动 2 个 server + 1 个 worker（worker 先起），模块迁移只执行一次，worker 等迁移完成而不是读到不存在的表
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPrisma } from "@app/db";
import { dropModuleTables } from "@app/core";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = getPrisma();
let bad = 0; const ok = (n: string, c: boolean, d = "") => { if (!c) bad++; console.log(`${c ? "✅" : "❌"} ${n} ${d}`); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "race-mods-"));
const mod = path.join(dir, "race-mod"); fs.mkdirSync(path.join(mod, "migrations"), { recursive: true });
fs.writeFileSync(path.join(mod, "module.manifest.json"), JSON.stringify({ apiVersion: 1, name: "race-mod", version: "1.0.0", kind: "external",
  external: { baseUrl: "http://127.0.0.1:9", health: "/health" }, tables: { owns: ["m_race_mod_t"] } }));
// 迁移故意 sleep 2 秒，放大竞争窗口
fs.writeFileSync(path.join(mod, "migrations", "001_init.sql"), "CREATE TABLE m_race_mod_t (id serial PRIMARY KEY);\nSELECT pg_sleep(2);\n");
fs.writeFileSync(path.join(mod, "migrations", "002_more.sql"), "ALTER TABLE m_race_mod_t ADD COLUMN note text;\n");
await dropModuleTables(db, "race-mod");

const procs: ChildProcess[] = []; const logs: Record<string, string> = {};
function run(name: string, script: string, extra: Record<string, string> = {}) {
  logs[name] = "";
  const p = spawn("npx", ["tsx", script], { cwd: root, detached: true, env: { ...process.env, MODULES_DIR: dir, ...extra } });
  p.stdout!.on("data", (b) => (logs[name] += b)); p.stderr!.on("data", (b) => (logs[name] += b)); procs.push(p);
}
const waitFor = async (name: string, re: RegExp, ms: number) => { const t = Date.now() + ms; while (Date.now() < t) { if (re.test(logs[name])) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
try {
  run("worker", "apps/worker/src/main.ts");
  run("server1", "apps/server/src/main.ts", { PORT: "4181" });
  run("server2", "apps/server/src/main.ts", { PORT: "4182" });
  const w = await waitFor("worker", /worker 已启动/, 60000);
  ok("worker 启动", w);
  ok("worker 没有因为表不存在而失败", !/race-mod.*failed|failed.*race-mod/.test(logs.worker), (logs.worker.match(/.*race-mod.*/g) ?? []).join(" | ").slice(0, 160));
  await waitFor("server1", /race-mod/, 30000); await waitFor("server2", /race-mod/, 30000);
  const rows = await db.moduleMigration.findMany({ where: { module: "race-mod" } });
  ok("两条迁移各只记录一次", rows.length === 2, JSON.stringify(rows.map((r) => r.name)));
  const ran = (logs.server1.match(/迁移已执行 race-mod/g) ?? []).length + (logs.server2.match(/迁移已执行 race-mod/g) ?? []).length;
  ok("两个 server 合计只执行 2 次迁移", ran === 2, `ran=${ran}`);
  const col = await db.$queryRawUnsafe<any[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'm_race_mod_t' AND column_name = 'note'`);
  ok("表结构完整", col.length === 1);
} finally { for (const p of procs) { try { process.kill(-p.pid!, "SIGTERM"); } catch { /* */ } } }
// 没有 server 时 worker 等待超时 -> 只有该模块 failed，消息清楚
await dropModuleTables(db, "race-mod");
run("worker2", "apps/worker/src/main.ts", { CONFIG_MODULES_MIGRATION_WAIT_TIMEOUT_MS: "1500" });
await waitFor("worker2", /worker 已启动/, 60000);
ok("没有 server 时 worker 等待超时，模块标记 failed 且原因清楚", /等待 server 执行迁移超时/.test(logs.worker2), (logs.worker2.match(/.*超时.*/) ?? [""])[0].slice(0, 120));
for (const p of procs) { try { process.kill(-p.pid!, "SIGTERM"); } catch { /* */ } }
await dropModuleTables(db, "race-mod"); fs.rmSync(dir, { recursive: true, force: true }); await db.$disconnect();
console.log(bad ? `${bad} 项失败` : "全部通过"); process.exit(bad ? 1 : 0);
