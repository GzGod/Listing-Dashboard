export * from "./types.js";
export * from "./host.js";
export * from "./loader.js";
export * from "./event-bus.js";
export * from "./errors.js";
export * from "./auth.js";
export * from "./db.js";
export * from "./ownership.js";
export * from "./config.js";
export { makeLogger, type Logger } from "./logger.js";
import type { ModuleManifest } from "./types.js";
/** 写 manifest 时用它包一下，获得类型提示 */
export const defineModule = (m: ModuleManifest) => m;
import { Prisma } from "@app/db";
/** 参数绑定的 SQL 片段：ctx.db.core.$queryRaw(sql`SELECT ... WHERE id IN (${join(ids)})`) */
export const sql = Prisma.sql;
export const join = Prisma.join;
export const empty = Prisma.empty;
// 刻意不导出 Prisma.raw（会绕过参数绑定）
export { makeModuleRedis } from "./redis.js";
export { writeTargets, isSingleReadQuery } from "./db.js";
