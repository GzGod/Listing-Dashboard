/** Formatting helpers; the no-data label always comes from config (passed in). */
export const usd = (n: number | null | undefined, empty: string) => n == null ? empty
  : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
export const num = (n: number | null | undefined, empty: string) => (n == null ? empty : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
/** "2026-10-30T13:05:00Z" -> "2026-10-30 13:05 UTC（北京 21:05）" */
export function utcTime(iso: string, tzOffsetHours: number) {
  const local = new Date(new Date(iso).getTime() + tzOffsetHours * 3600_000);
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC（北京 ${local.toISOString().slice(11, 16)}）`;
}
