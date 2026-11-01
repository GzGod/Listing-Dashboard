export interface HttpOpts {
  timeoutMs: number; retries: number; retryDelayMs: number; headers?: Record<string, string>;
  maxRetryDelayMs?: number;
  rateLimitPerMin?: number;
  /** 限速和计费必须覆盖每次重试。 */
  beforeAttempt?: () => Promise<void>;
}
export class HttpError extends Error {
  constructor(public status: number, public retryAfterMs: number | null, endpoint: string) { super(`HTTP ${status} ${endpoint}`); }
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const value = headers.get("retry-after");
  if (value != null) {
    const delay = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
    if (Number.isFinite(delay)) return Math.max(0, delay);
  }
  const reset = Number(headers.get("x-rate-limit-reset"));
  return reset > 0 ? Math.max(0, reset * 1000 - now) : null;
}
export async function getJson<T = any>(url: string, o: HttpOpts): Promise<T> {
  const parsed = new URL(url); const endpoint = parsed.origin + parsed.pathname;
  const attempts = Math.max(1, o.retries); let last: unknown;
  for (let i = 0; i < attempts; i++) {
    await o.beforeAttempt?.();
    try {
      const res = await fetch(url, { headers: o.headers, signal: AbortSignal.timeout(o.timeoutMs) });
      if (!res.ok) {
        const delay = retryAfterMs(res.headers);
        await res.body?.cancel();
        throw new HttpError(res.status, delay, endpoint);
      }
      try { return await res.json() as T; }
      catch { throw new HttpError(422, null, endpoint + " 返回非 JSON 响应"); }
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      if (i === attempts - 1) break;
      const delay = e instanceof HttpError && e.retryAfterMs != null ? e.retryAfterMs : o.retryDelayMs * 2 ** i;
      if (delay > (o.maxRetryDelayMs ?? 60000)) throw e;
      if (delay) await sleep(delay);
    }
  }
  throw last;
}
export function rateLimiter(perMin: number) {
  const gap = 60000 / Math.max(1, perMin); let next = 0;
  return async () => { const now = Date.now(); const wait = Math.max(0, next - now); next = Math.max(now, next) + gap; if (wait) await sleep(wait); };
}
