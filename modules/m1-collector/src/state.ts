import { randomUUID } from "node:crypto";
import { AppError, type ModuleContext } from "@app/core";
import { OWN, loadConfig, type M1Config } from "./config.js";
import { dayIn } from "./day.js";

/** 跨 server/worker 的租约，防手动触发与定时任务重叠。 */
export async function withRunLock<T>(ctx: ModuleContext, name: string, ttl: number, run: (check: () => void) => Promise<T>): Promise<T> {
  const owner = randomUUID();
  const rows = await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.locks)} (name,owner,expires_at) VALUES ($1,$2,now()+$3 * interval '1 millisecond')
    ON CONFLICT (name) DO UPDATE SET owner=$2,expires_at=now()+$3 * interval '1 millisecond'
    WHERE ${ctx.db.t(OWN.locks)}.expires_at <= now() RETURNING name`, name, owner, ttl);
  if (!rows.length) throw new AppError(409, "COLLECTOR_BUSY", "同类采集任务正在运行，请稍后重试");
  let lost = false;
  const timer = setInterval(() => {
    void ctx.db.query(`UPDATE ${ctx.db.t(OWN.locks)} SET expires_at=now()+$3 * interval '1 millisecond' WHERE name=$1 AND owner=$2 RETURNING name`, name, owner, ttl)
      .then((r) => { if (!r.length) lost = true; }).catch(() => { lost = true; });
  }, Math.floor(ttl / 3));
  timer.unref();
  const check = () => { if (lost) throw new Error("采集任务租约已失效，请重试"); };
  try { return await run(check); }
  finally { clearInterval(timer); await ctx.db.query(`DELETE FROM ${ctx.db.t(OWN.locks)} WHERE name=$1 AND owner=$2`, name, owner); }
}

/** 原子计数，进程退出也不会丢失已消耗预算；由 HTTP beforeAttempt 调用。 */
export async function claimRateSlot(ctx: ModuleContext, name: string, perMin: number) {
  const gap = 60000 / perMin;
  const [row] = await ctx.db.query<{ wait_ms: number }>(`INSERT INTO ${ctx.db.t(OWN.rates)} (name,next_at) VALUES ($1,now()+$2 * interval '1 millisecond')
    ON CONFLICT (name) DO UPDATE SET next_at=greatest(${ctx.db.t(OWN.rates)}.next_at,now())+$2 * interval '1 millisecond'
    RETURNING greatest(0,extract(epoch FROM (next_at-now()))*1000-$2)::float8 AS wait_ms`, name, gap);
  if (row.wait_ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, row.wait_ms));
}

export async function claimXCall(ctx: ModuleContext, c: M1Config) {
  const rows = await ctx.db.query<{ count: number }>(`INSERT INTO ${ctx.db.t(OWN.runs)} (kind,day,count)
    SELECT 'x_calls',$1::date,1 WHERE $2 > 0
    ON CONFLICT (kind,day) DO UPDATE SET count=${ctx.db.t(OWN.runs)}.count+1,updated_at=now()
    WHERE ${ctx.db.t(OWN.runs)}.count < $2 RETURNING count`, dayIn(c.tz), c.xDailyCap);
  if (!rows.length) throw new AppError(429, "X_BUDGET_EXHAUSTED", "X 每日调用上限已用完（含重试）");
  await claimRateSlot(ctx, "x", c.xRateLimitPerMin);
}

export async function recordRun(ctx: ModuleContext, kind: string, day: string, detail: unknown, done: boolean, count = 0) {
  await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.runs)} (kind,day,detail,done,count) VALUES ($1,$2::date,$3::jsonb,$4,$5)
    ON CONFLICT (kind,day) DO UPDATE SET detail=$3::jsonb,done=$4,count=$5,updated_at=now()`, kind, day, JSON.stringify(detail), done, count);
}

export async function queueEvent(ctx: ModuleContext, dedupeKey: string, event: string, payload: unknown) {
  await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.outbox)} (dedupe_key,event,payload) VALUES ($1,$2,$3::jsonb)
    ON CONFLICT (dedupe_key) DO UPDATE SET payload=$3::jsonb,revision=${ctx.db.t(OWN.outbox)}.revision+1,sent=false,updated_at=now()`, dedupeKey, event, JSON.stringify(payload));
}

/** 至少一次投递；下游幂等。先持久化，发出后再标记，崩溃后可恢复。 */
export async function flushOutbox(ctx: ModuleContext) {
  const c = await loadConfig(ctx);
  const rows = await ctx.db.query<{ id: number; event: string; payload: unknown; revision: number }>(`SELECT id,event,payload,revision FROM ${ctx.db.t(OWN.outbox)} WHERE sent=false ORDER BY id LIMIT $1`, c.outboxBatchSize);
  for (const row of rows) {
    await ctx.events.emit(row.event, row.payload);
    await ctx.db.query(`UPDATE ${ctx.db.t(OWN.outbox)} SET sent=true WHERE id=$1 AND revision=$2`, row.id, row.revision);
  }
  await ctx.db.query(`DELETE FROM ${ctx.db.t(OWN.outbox)} WHERE sent=true AND updated_at < now()-$1 * interval '1 day'`, c.outboxRetentionDays);
  return { dispatched: rows.length };
}
