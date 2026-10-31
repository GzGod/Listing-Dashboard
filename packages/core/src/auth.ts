import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { PrismaClient } from "@app/db";
import type { LoginRequest, LoginResponse, Role } from "@app/shared";
import { AppError } from "./errors.js";
import { staticCfg } from "./event-bus.js";
import type { ModuleRecord } from "./types.js";

export interface AuthUser { id: number; email: string; name: string; role: Role }
declare module "fastify" { interface FastifyRequest { user?: AuthUser } }

/** 底座内置权限 + 各模块 manifest.permissions 合成的“角色 -> 权限”表 */
export class Permissions {
  private byRole = new Map<string, Set<string>>([
    ["admin", new Set(["*"])],
    ["editor", new Set(["core:read", "admin:access"])], // 底座权限：core:read / admin:access / config:write（仅 admin）
    ["viewer", new Set(["core:read"])],
  ]);
  addFromModules(records: ModuleRecord[]) {
    for (const r of records) for (const p of r.manifest.permissions ?? []) for (const role of p.roles) this.byRole.get(role)?.add(p.key);
  }
  list(role: string) { return [...(this.byRole.get(role) ?? [])]; }
  has(role: string, perm: string) { const s = this.byRole.get(role); return !!s && (s.has("*") || s.has(perm)); }
}

export class Auth {
  constructor(private db: PrismaClient, public perms: Permissions, private secret = process.env.JWT_SECRET ?? "dev-secret-change-me") {}
  sign(u: AuthUser) { return jwt.sign(u, this.secret, { expiresIn: staticCfg("auth.jwtExpires") as any }); }
  verify(token: string): AuthUser { return jwt.verify(token, this.secret) as AuthUser; }

  /** 全局钩子：解析 Bearer token；/api/_core/auth/login、/api/_core/health 以外的 /api 都要登录 */
  install(app: FastifyInstance, publicPaths: RegExp[]) {
    app.addHook("onRequest", async (req) => {
      const h = req.headers.authorization;
      if (h?.startsWith("Bearer ")) { try { req.user = this.verify(h.slice(7)); } catch { throw new AppError(401, "UNAUTHORIZED", "登录已过期，请重新登录"); } }
      // AUTH_DISABLED=1：演示模式，免登录，匿名请求按 admin 处理
      if (!req.user && process.env.AUTH_DISABLED === "1") req.user = { id: 0, email: "demo@local", name: "演示", role: "admin" as Role };
      const url = req.url.split("?")[0];
      if (url.startsWith("/api/") && !publicPaths.some((r) => r.test(url)) && !req.user) throw new AppError(401, "UNAUTHORIZED", "请先登录");
    });
    app.post("/api/_core/auth/login", async (req): Promise<LoginResponse> => {
      const { email, password } = (req.body ?? {}) as LoginRequest;
      const u = email ? await this.db.user.findUnique({ where: { email } }) : null;
      if (!u || !u.enabled || !(await bcrypt.compare(password ?? "", u.passwordHash))) throw new AppError(401, "BAD_CREDENTIALS", "账号或密码错误");
      const user: AuthUser = { id: u.id, email: u.email, name: u.name, role: u.role as Role };
      return { token: this.sign(user), user: { ...user, permissions: this.perms.list(u.role) } };
    });
    app.get("/api/_core/auth/me", async (req) => ({ user: { ...req.user!, permissions: this.perms.list(req.user!.role) } }));
  }
  require(perm: string): preHandlerHookHandler {
    return async (req: FastifyRequest) => {
      if (!req.user) throw new AppError(401, "UNAUTHORIZED", "请先登录");
      if (!this.perms.has(req.user.role, perm)) throw new AppError(403, "FORBIDDEN", `缺少权限 ${perm}`);
    };
  }
}
