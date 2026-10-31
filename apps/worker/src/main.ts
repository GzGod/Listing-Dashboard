// 独立 worker 进程：消费事件队列、跑定时任务。任务失败自动重试，用尽进 dead-letter 队列。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleHost, makeLogger } from "@app/core";
import { getPrisma } from "@app/db";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const log = makeLogger("worker");
const host = new ModuleHost({ role: "worker", db: getPrisma(), modulesDir: process.env.MODULES_DIR ?? path.join(root, "modules"),
  disabled: (process.env.DISABLED_MODULES ?? "").split(",").filter(Boolean) });
await host.boot();
await host.startWorker(async (r, envelope) => {
  // http 方式投递给外部服务模块：POST <baseUrl>/_events，非 2xx 视为失败（会重试）
  const res = await fetch(`${r.manifest.external!.baseUrl.replace(/\/$/, "")}/_events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(r.manifest.external!.timeoutMs ?? await host.config.get("external.timeoutMs")),
  });
  if (!res.ok) throw new Error(`外部模块 ${r.manifest.name} 返回 HTTP ${res.status}`);
});
log.info("worker 已启动");
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await host.shutdown(); process.exit(0); });
