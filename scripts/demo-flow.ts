// pnpm demo —— 验收脚本：全程不改底座代码，走完
//   注册(复制模板成新模块) → 挂载(启动 server/worker) → 页面显示(菜单出现) → 读写自有表 + 审计 → 收发事件 → 定时任务手动触发
//   → 外部 Python 模块（如在线）→ 卸载(删表、移走目录) → 重启后模块消失、表已删除、核心表不受影响
// 自己起一套 server(DEMO_PORT, 默认 4100) + worker，跑完自动关闭。需要 DATABASE_URL / REDIS_URL。
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPrisma } from "@app/db";
import { EventBus } from "@app/core";
import { createModule } from "./new-module.js";
import { uninstallModule } from "./uninstall-module.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DEMO_PORT ?? 4100);
const BASE = `http://localhost:${PORT}`;
const NAME = process.env.DEMO_MODULE ?? `demo-${Date.now().toString(36)}`;
const TABLE = `m_${NAME.replace(/-/g, "_")}_items`;
const db = getPrisma();
let procs: ChildProcess[] = [];
let failed = 0;
const step = (ok: boolean, msg: string, extra?: unknown) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}${extra !== undefined ? "  " + JSON.stringify(extra).slice(0, 200) : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function up() {
  const env = { ...process.env, PORT: String(PORT) };
  procs = [spawn("npx", ["tsx", "apps/server/src/main.ts"], { cwd: root, env, stdio: "ignore", detached: true }), spawn("npx", ["tsx", "apps/worker/src/main.ts"], { cwd: root, env, stdio: "ignore", detached: true })];
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/_core/health`)).ok) { await sleep(2500); return; } } catch { /* 继续等 */ } await sleep(500); }
  throw new Error("server 没起来");
}
async function down() { procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch { /* 忽略 */ } }); await sleep(2500); procs = []; }
async function call(method: string, p: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const tableExists = async (t: string) => (await db.$queryRawUnsafe<any[]>(`SELECT 1 FROM pg_tables WHERE tablename = $1`, t)).length > 0;

try {
  console.log(`\n== 1. 注册：从模板复制 modules/${NAME}（不改底座代码）`);
  createModule(NAME);
  // 新模块需要的 @app/* 依赖由 pnpm workspace 提供；这里直接软链，免得 demo 里跑 pnpm install
  const fs = await import("node:fs");
  fs.mkdirSync(path.join(root, "modules", NAME, "node_modules/@app"), { recursive: true });
  for (const p of ["core", "shared", "ui"]) fs.symlinkSync(path.join(root, "packages", p), path.join(root, "modules", NAME, "node_modules/@app", p));
  step(true, "模块目录已创建");

  console.log("\n== 2. 挂载：启动 server + worker");
  await up();
  const login = await call("POST", "/api/_core/auth/login", undefined, { email: "admin@local", password: "admin123" });
  step(login.status === 200, "admin 登录（JWT）"); const T = login.body.token;
  const bad = await call("POST", "/api/_core/auth/login", undefined, { email: "admin@local", password: "wrong" });
  step(bad.status === 401 && bad.body.error.code === "BAD_CREDENTIALS", "错误密码被拒，统一错误格式", bad.body);
  const mods = await call("GET", "/api/_core/modules", T);
  const me = mods.body.modules.find((m: any) => m.id === NAME);
  step(me?.status === "started", `${NAME} 已挂载`, me?.status);
  step(await tableExists(TABLE), `迁移已建表 ${TABLE}`);

  console.log("\n== 3. 页面显示：菜单由 manifest 自动生成");
  const menu = await call("GET", "/api/_core/menu", T);
  step(menu.body.some((m: any) => m.module === NAME && m.area === "admin"), "后台菜单出现新模块");
  const viewer = (await call("POST", "/api/_core/auth/login", undefined, { email: "viewer@local", password: "admin123" })).body.token;
  const vmenu = await call("GET", "/api/_core/menu", viewer);
  step(!vmenu.body.some((m: any) => m.area === "admin"), "viewer 看不到后台菜单（权限）");

  console.log("\n== 4. 读写自有表 + 审计日志");
  const created = await call("POST", `/api/${NAME}/items`, T, { title: "hello from demo" });
  step(created.status === 200 && created.body.title === "hello from demo", "写入自有表", created.body);
  const list = await call("GET", `/api/${NAME}/items`, T);
  step(list.body.length === 1, "读出自有表", list.body);
  const denied = await call("POST", `/api/${NAME}/items`, viewer, { title: "x" });
  step(denied.status === 403, "viewer 写入被拒（403）");
  const audit = await db.auditLog.findFirst({ where: { module: NAME, table: TABLE } });
  step(!!audit, "audit_logs 已记录", audit && { action: audit.action, recordId: audit.recordId });

  console.log("\n== 5. 事件（BullMQ，worker 进程消费）");
  const bus = new EventBus();
  bus.setSubscribers([{ manifest: { apiVersion: 1, name: "example", version: "1.0.0", subscribes: ["post.ingested"] }, dir: "", status: "started" }]);
  await bus.emit("post.ingested", { postIds: [42], platform: "X", ingestedAt: new Date().toISOString() }, "demo");
  await bus.close();
  await sleep(2500);
  const got = await db.$queryRawUnsafe<any[]>(`SELECT text FROM m_example_notes WHERE text LIKE '%postIds=42%' ORDER BY id DESC LIMIT 1`).catch(() => []);
  step(got.length === 1, "example 模块收到 post.ingested 并写入自有表", got[0]);
  const job = await call("POST", "/api/_core/jobs/example/heartbeat/run", T, {});
  await sleep(2000);
  const hb = await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int c FROM m_example_notes WHERE source = 'job'`);
  step(job.body.queued && hb[0].c > 0, "手动触发定时任务 example:heartbeat");

  console.log("\n== 6. 外部 Python 模块（py-example）");
  const py = mods.body.modules.find((m: any) => m.id === "py-example");
  if (py?.status === "started") {
    const add = await call("POST", "/api/py-example/items", T, { title: "from demo" });
    step(add.status === 200, "经底座代理写 Python 模块自有表", add.body);
    await call("POST", "/api/example/emit", T);
    await sleep(2500);
    const items = await call("GET", "/api/py-example/items", T);
    step(items.body.some((i: any) => i.source === "event"), "Python 模块收到 TS 模块发的 recalc.requested");
  } else console.log(`⚠️  py-example 状态 ${py?.status}（${py?.error ?? ""}），跳过`);

  console.log("\n== 7. 卸载");
  await down();
  const un = await uninstallModule(NAME);
  step(un.dropped.includes(TABLE), "自有表已删除", un.dropped);
  await up();
  const T2 = (await call("POST", "/api/_core/auth/login", undefined, { email: "admin@local", password: "admin123" })).body.token;
  const after = await call("GET", "/api/_core/modules", T2);
  step(!after.body.modules.some((m: any) => m.id === NAME), "重启后模块已消失");
  step(!(await call("GET", "/api/_core/menu", T2)).body.some((m: any) => m.module === NAME), "菜单已消失");
  step((await call("GET", `/api/${NAME}/items`, T2)).status === 404, "接口已下线（404）");
  step((await db.project.count()) > 0 && (await db.auditLog.count({ where: { module: NAME } })) > 0, "核心表和审计日志未受影响");
  console.log(`\n目录已移到 ${un.movedTo}（可恢复）`);
} catch (e) { failed++; console.error("❌ 异常", e); }
finally { await down(); await db.$disconnect(); console.log(failed ? `\n${failed} 项失败` : "\n全部通过"); process.exit(failed ? 1 : 0); }
