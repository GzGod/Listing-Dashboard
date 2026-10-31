/** UTC 日期字符串 YYYY-MM-DD 的校验（底座通用契约）。
 *  不存在的日期（2026-13-01、2026-02-30）返回 false，绝不抛异常——抛了会变成 500，应该返回 400。 */
export const isValidDay = (s: string): boolean => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
