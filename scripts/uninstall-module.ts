// pnpm module:uninstall <name> [--keep-files]
// 卸载 = 删 m_<name>_* 自有表和迁移记录 + 清理它的队列/定时任务 + 把目录移到 .uninstalled/（可恢复）。核心表一律不动。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { getPrisma } from "@app/db";
import { dropModuleTables, moduleQueue, redisConnection, JOBS_QUEUE } from "@app/core";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function uninstallModule(name: string, opts: { keepFiles?: boolean; modulesDir?: string } = {}) {
  const db = getPrisma();
  const dropped = await dropModuleTables(db, name);
  const conn = redisConnection();
  const jobs = new Queue(JOBS_QUEUE, { connection: conn });
  for (const s of await jobs.getJobSchedulers()) if (s.key?.startsWith(`${name}:`)) await jobs.removeJobScheduler(s.key);
  await jobs.close();
  const mq = new Queue(moduleQueue(name), { connection: conn }); await mq.obliterate({ force: true }); await mq.close();
  let movedTo: string | undefined;
  const dir = path.join(opts.modulesDir ?? path.join(root, "modules"), name);
  if (!opts.keepFiles && fs.existsSync(dir)) {
    movedTo = path.join(root, ".uninstalled", `${name}-${Date.now()}`);
    fs.mkdirSync(path.dirname(movedTo), { recursive: true }); fs.renameSync(dir, movedTo);
  }
  return { dropped, movedTo };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const name = process.argv[2]; if (!name) { console.error("用法: pnpm module:uninstall <name> [--keep-files]"); process.exit(1); }
  const r = await uninstallModule(name, { keepFiles: process.argv.includes("--keep-files") });
  console.log(`已删除表: ${r.dropped.join(", ") || "无"}${r.movedTo ? `；目录已移到 ${r.movedTo}` : ""}。重启 server/worker 生效。`);
  await getPrisma().$disconnect(); process.exit(0);
}
