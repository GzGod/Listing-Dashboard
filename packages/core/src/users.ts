import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@app/db";
import { AppError } from "./errors.js";
import { makeAudit } from "./audit.js";
import type { Auth } from "./auth.js";

const ROLES = ["admin", "editor", "viewer"];
const pub = (u: any) => ({ id: u.id, email: u.email, name: u.name, role: u.role, enabled: u.enabled, createdAt: u.createdAt });

/** 底座账号接口（users 表只有底座写）。M4 的 AD-07 页面调用这些接口。需要 users:manage（默认只有 admin），全部写审计 */
export function registerUserRoutes(app: FastifyInstance, db: PrismaClient, auth: Auth) {
  const audit = makeAudit(db, "_core");
  const pre = { preHandler: auth.require("users:manage") };
  const find = async (id: number) => { const u = await db.user.findUnique({ where: { id } }); if (!u) throw new AppError(404, "NOT_FOUND", "账号不存在"); return u; };
  const notSelf = (req: any, id: number, what: string) => { if (req.user.id === id) throw new AppError(400, "BAD_REQUEST", `不能${what}自己的账号`); };

  app.get("/api/_core/users", pre, async () => (await db.user.findMany({ orderBy: { id: "asc" } })).map(pub));
  app.post("/api/_core/users", pre, async (req) => {
    const { email, name, role = "viewer", password } = (req.body ?? {}) as any;
    if (!email || !name) throw new AppError(400, "BAD_REQUEST", "email 和 name 必填");
    if (!ROLES.includes(role)) throw new AppError(400, "BAD_REQUEST", `role 只能是 ${ROLES.join("/")}`);
    if (await db.user.findUnique({ where: { email } })) throw new AppError(409, "CONFLICT", "邮箱已存在");
    const pw = password || randomBytes(9).toString("base64url");
    const u = await db.user.create({ data: { email, name, role, passwordHash: await bcrypt.hash(pw, 10) } });
    await audit({ action: "user.create", table: "users", recordId: u.id, after: pub(u), actorId: req.user!.id });
    return { user: pub(u), ...(password ? {} : { initialPassword: pw }) };
  });
  app.patch("/api/_core/users/:id/role", pre, async (req) => {
    const id = Number((req.params as any).id); const { role } = (req.body ?? {}) as any;
    if (!ROLES.includes(role)) throw new AppError(400, "BAD_REQUEST", `role 只能是 ${ROLES.join("/")}`);
    notSelf(req, id, "修改");
    const before = await find(id); const u = await db.user.update({ where: { id }, data: { role } });
    await audit({ action: "user.role", table: "users", recordId: id, before: { role: before.role }, after: { role }, actorId: req.user!.id });
    return pub(u);
  });
  for (const [path, enabled] of [["disable", false], ["enable", true]] as const)
    app.post(`/api/_core/users/:id/${path}`, pre, async (req) => {
      const id = Number((req.params as any).id); if (!enabled) notSelf(req, id, "停用");
      const before = await find(id); const u = await db.user.update({ where: { id }, data: { enabled } });
      await audit({ action: `user.${path}`, table: "users", recordId: id, before: { enabled: before.enabled }, after: { enabled }, actorId: req.user!.id });
      return pub(u);
    });
  app.post("/api/_core/users/:id/reset-password", pre, async (req) => {
    const id = Number((req.params as any).id); await find(id);
    const pw = ((req.body ?? {}) as any).password || randomBytes(9).toString("base64url");
    await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 10) } });
    await audit({ action: "user.reset_password", table: "users", recordId: id, actorId: req.user!.id }); // 不记录密码
    return { ok: true, ...(((req.body ?? {}) as any).password ? {} : { newPassword: pw }) };
  });
}
