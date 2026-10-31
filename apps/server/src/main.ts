// 后端入口（Fastify）。底座代码；接入模块不需要改这个文件。
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleHost, installErrorHandler } from "@app/core";
import { getPrisma } from "@app/db";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: () => Math.random().toString(36).slice(2, 10) });
installErrorHandler(app);
const host = new ModuleHost({ role: "server", app, db: getPrisma(), modulesDir: process.env.MODULES_DIR ?? path.join(root, "modules"),
  disabled: (process.env.DISABLED_MODULES ?? "").split(",").filter(Boolean) });
host.auth.install(app, [/^\/api\/_core\/(auth\/login|health)$/, /^\/api\/_core\/events$/]);
await host.boot();
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4000) });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await host.shutdown(); await app.close(); process.exit(0); });
