import type { PrismaClient } from "@app/db";
import type { AuditEntry } from "./types.js";
const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))));
/** 审计日志：任何表的修改一行代码 ctx.audit({ action, table, recordId, before, after }) 写入 audit_logs */
export function makeAudit(db: PrismaClient, module: string) {
  return async (e: AuditEntry) => {
    await db.auditLog.create({ data: { module, action: e.action, table: e.table ?? null, recordId: e.recordId == null ? null : String(e.recordId),
      before: json(e.before), after: json(e.after), actorId: e.actorId ?? null } });
  };
}
