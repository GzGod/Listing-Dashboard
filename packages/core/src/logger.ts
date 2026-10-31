// 统一日志：一行一条 JSON，带模块名，方便 docker logs / 日志平台检索
export type Logger = Record<"debug" | "info" | "warn" | "error", (msg: string, extra?: unknown) => void>;
export function makeLogger(scope: string): Logger {
  const w = (level: string) => (msg: string, extra?: unknown) =>
    (level === "error" ? process.stderr : process.stdout).write(JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...(extra !== undefined ? { extra } : {}) }) + "\n");
  return { debug: process.env.LOG_LEVEL === "debug" ? w("debug") : () => {}, info: w("info"), warn: w("warn"), error: w("error") };
}
