// pnpm test:api —— 进程内起一个底座（临时模块目录），测账号接口 + 外部模块代理超时(504)/不可达(502)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import Fastify from "fastify";
import { getPrisma } from "@app/db";
import { ModuleHost, installErrorHandler } from "@app/core";
const db = getPrisma(); let bad = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { if (!cond) bad++; console.log(`${cond ? "✅" : "❌"} ${name}${extra !== undefined ? "  " + JSON.stringify(extra).slice(0, 160) : ""}`); };

// 一个故意很慢的外部服务：/health 正常，/slow 2 秒后才回
const slow = http.createServer((req, res) => { if (req.url === "/health") { res.end("{}"); return; } setTimeout(() => res.end("{}"), 2000); }).listen(0);
const port = (slow.address() as any).port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mods-"));
fs.mkdirSync(path.join(dir, "slow-ext"));
fs.writeFileSync(path.join(dir, "slow-ext/module.manifest.json"), JSON.stringify({ apiVersion: 1, name: "slow-ext", version: "1.0.0", kind: "external", external: { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 300 } }));
fs.mkdirSync(path.join(dir, "dead-ext"));
fs.writeFileSync(path.join(dir, "dead-ext/module.manifest.json"), JSON.stringify({ apiVersion: 1, name: "dead-ext", version: "1.0.0", kind: "external", external: { baseUrl: "http://127.0.0.1:1" } }));

const app = Fastify(); installErrorHandler(app);
const host = new ModuleHost({ role: "server", app, db, modulesDir: dir });
host.auth.install(app, [/^\/api\/_core\/(auth\/login|health)$/]);
await host.boot(); await app.ready();
const login = async (email: string, password = "admin123") => (await app.inject({ method: "POST", url: "/api/_core/auth/login", payload: { email, password } })).json().token;
const A = { authorization: `Bearer ${await login("admin@local")}` };
const E = { authorization: `Bearer ${await login("editor@local")}` };

// ---- 外部模块代理 ----
host.get("slow-ext")!.status = "started";
const t = await app.inject({ method: "GET", url: "/api/slow-ext/slow", headers: A });
ok("外部模块超时 -> 504 MODULE_TIMEOUT", t.statusCode === 504 && t.json().error.code === "MODULE_TIMEOUT", t.json());
host.get("dead-ext")!.status = "started";
const d = await app.inject({ method: "GET", url: "/api/dead-ext/x", headers: A });
ok("外部模块不可达 -> 502 MODULE_UNREACHABLE", d.statusCode === 502, d.json());
host.get("dead-ext")!.status = "unavailable";
ok("被标成不可用 -> 503", (await app.inject({ method: "GET", url: "/api/dead-ext/x", headers: A })).statusCode === 503);

// ---- 账号接口 ----
const email = `t${Date.now()}@local`;
ok("editor 无权访问账号接口 (403)", (await app.inject({ method: "GET", url: "/api/_core/users", headers: E })).statusCode === 403);
const c = await app.inject({ method: "POST", url: "/api/_core/users", headers: A, payload: { email, name: "测试", role: "viewer" } });
const uid = c.json().user?.id; const initPw = c.json().initialPassword;
ok("创建账号（返回初始密码）", c.statusCode === 200 && !!initPw, c.json().user);
ok("新账号能用初始密码登录", !!(await login(email, initPw)));
ok("列表包含新账号且不含密码哈希", (await app.inject({ method: "GET", url: "/api/_core/users", headers: A })).json().some((u: any) => u.id === uid && !("passwordHash" in u)));
ok("改角色为 editor", (await app.inject({ method: "PATCH", url: `/api/_core/users/${uid}/role`, headers: A, payload: { role: "editor" } })).json().role === "editor");
ok("非法角色被拒 (400)", (await app.inject({ method: "PATCH", url: `/api/_core/users/${uid}/role`, headers: A, payload: { role: "root" } })).statusCode === 400);
const r = await app.inject({ method: "POST", url: `/api/_core/users/${uid}/reset-password`, headers: A, payload: {} });
ok("重置密码后新密码可登录", !!(await login(email, r.json().newPassword)));
await app.inject({ method: "POST", url: `/api/_core/users/${uid}/disable`, headers: A });
const dl = await app.inject({ method: "POST", url: "/api/_core/auth/login", payload: { email, password: r.json().newPassword } });
ok("停用后不能登录 (401)", dl.statusCode === 401);
const adminId = (await db.user.findUnique({ where: { email: "admin@local" } }))!.id;
ok("不能停用自己 (400)", (await app.inject({ method: "POST", url: `/api/_core/users/${adminId}/disable`, headers: A })).statusCode === 400);
const logs = await db.auditLog.findMany({ where: { table: "users", recordId: String(uid) }, orderBy: { id: "asc" } });
ok("全部写了审计（create/role/reset/disable）", ["user.create", "user.role", "user.reset_password", "user.disable"].every((a) => logs.some((l) => l.action === a)), logs.map((l) => l.action));
ok("审计里没有密码", !JSON.stringify(logs, (_k, v) => (typeof v === "bigint" ? String(v) : v)).match(/password(Hash)?"\s*:/i));
await db.user.delete({ where: { id: uid } });

await host.shutdown(); await app.close(); slow.close(); fs.rmSync(dir, { recursive: true }); await db.$disconnect();
console.log(bad ? `${bad} 项失败` : "全部通过"); process.exit(bad ? 1 : 0);
