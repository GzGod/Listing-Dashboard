// 带超时 + 重试的 fetch（超时/重试次数来自配置）
export interface HttpOpts { timeoutMs: number; retries: number; retryDelayMs: number; headers?: Record<string, string> }
export async function getJson<T = any>(url: string, o: HttpOpts): Promise<T> {
  let last: unknown;
  for (let i = 0; i < Math.max(1, o.retries); i++) {
    try {
      const res = await fetch(url, { headers: o.headers, signal: AbortSignal.timeout(o.timeoutMs) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${url}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      return (await res.json()) as T;
    } catch (e: any) {
      last = e;
      if (e?.fatal) break;
      await new Promise((r) => setTimeout(r, o.retryDelayMs * 2 ** i));
    }
  }
  throw last;
}
/** 简单限速器：每分钟最多 n 次 */
export function rateLimiter(perMin: number) {
  const gap = 60000 / Math.max(1, perMin); let next = 0;
  return async () => { const now = Date.now(); const wait = Math.max(0, next - now); next = Math.max(now, next) + gap; if (wait) await new Promise((r) => setTimeout(r, wait)); };
}
