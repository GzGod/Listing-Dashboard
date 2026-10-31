/**
 * Module-local UTC-day helpers (duplicated per module on purpose: no shared package for these).
 * Days are cut in the time zone from base config `time.dayCutTimezone` (IANA, default 'UTC').
 */
import { isValidDay as baseIsValidDay } from '@app/shared';

const DAY_MS = 86_400_000;

export function utcDay(d: Date): string { return d.toISOString().slice(0, 10); }
/** isValidDay from the @app/shared root (MODULE_GUIDE recommendation) — no local copy */
export const isValidDay: (s: string) => boolean = baseIsValidDay;
export function addDays(day: string, n: number): string { return utcDay(new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS)); }
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function dayInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
/** today in the day-cut zone, shifted by offsetDays (−1 => yesterday) */
export function referenceDay(now: Date, dayCutTimezone: string, offsetDays: number): string {
  return addDays(dayInTimeZone(now, dayCutTimezone), offsetDays);
}

/** offset (ms) of `timeZone` from UTC at instant `t` */
function tzOffsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}
/** UTC instant (ISO, ms) of 00:00 of `day` in the day-cut zone, e.g. ('2026-10-30','Asia/Shanghai') -> '2026-10-29T16:00:00.000Z' */
export function dayStartUtcIso(day: string, timeZone: string): string {
  const guess = Date.parse(day + 'T00:00:00Z');
  let t = guess - tzOffsetMs(guess, timeZone);
  t = guess - tzOffsetMs(t, timeZone); // DST-safe second pass
  return new Date(t).toISOString();
}
