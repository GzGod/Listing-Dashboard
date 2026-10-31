// 切日工具：和 M2 同一套语义——某时刻在底座切日时区 time.dayCutTimezone（默认 UTC）下的 YYYY-MM-DD。不写死时区。
export function dayIn(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
/** YYYY-MM-DD 加减天数（纯日历运算，与时区无关） */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
}
/** 发帖后是否仍在回抓窗口：发帖日（切日时区）>= 今天 - refetchDays */
export function inRefetchWindow(postedAt: Date, refetchDays: number, tz: string, now: Date = new Date()): boolean {
  return dayIn(tz, postedAt) >= addDays(dayIn(tz, now), -refetchDays);
}
/** 日期字段存库：@db.Date 用该日 00:00Z 表示 */
export const dbDate = (day: string) => new Date(day + "T00:00:00Z");
