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

/** 指定时区本地午夜对应的 UTC 时间，二次校正覆盖夏令时。 */
export function dayStartMs(day: string, tz: string): number {
  const guess = Date.parse(day + "T00:00:00Z");
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - t;
  };
  let t = guess - offset(guess); t = guess - offset(t);
  return t;
}
