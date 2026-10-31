import type { ModuleContext } from "@app/core";
import type { RecalcRequestedEvent } from "@app/shared";
export { isValidDay } from "@app/shared";
import { EVENTS } from "./config.js";
// 直接用底座 @app/shared 的强类型：{ reason, projectIds?: number[], dateFrom, dateTo }
export type M4RecalcRequested = RecalcRequestedEvent;
/** 切日时区（配置中心 time.dayCutTimezone，不写死） */
export const dayCutTz = async (ctx: ModuleContext) => String(await ctx.config.get("time.dayCutTimezone"));
/** 按切日时区算“今天” YYYY-MM-DD */
export const todayIn = (tz: string, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const today = async (ctx: ModuleContext) => todayIn(await dayCutTz(ctx));
export const toIds = (ids: unknown): number[] | undefined => {
  const arr = (Array.isArray(ids) ? ids : ids == null || ids === "" ? [] : String(ids).split(",")).map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n) && n > 0);
  return arr.length ? arr : undefined;
};
export async function emitRecalc(ctx: ModuleContext, p: M4RecalcRequested) {
  await ctx.events.emit(EVENTS.recalc, p);
}
