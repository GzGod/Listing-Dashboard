// pnpm test:redis —— ctx.redis：前缀隔离 + Redis 挂了错误只落在模块
import { makeModuleRedis } from "@app/core";
let bad = 0; const ok = (n: string, c: boolean, d = "") => { if (!c) bad++; console.log(`${c ? "✅" : "❌"} ${n} ${d}`); };
const log = { warn: () => {} };
const a = makeModuleRedis("mod-a", log), b = makeModuleRedis("mod-b", log);
const raw = a.duplicate({ keyPrefix: "" }); // 无前缀的同库连接，用来看真实 key
await a.set("k", "A"); await b.set("k", "B");
ok("同名 key 互不覆盖", (await a.get("k")) === "A" && (await b.get("k")) === "B");
ok("实际 key 带 m:<模块名>: 前缀", (await raw.get("m:mod-a:k")) === "A" && (await raw.get("m:mod-b:k")) === "B");
await raw.del("m:mod-a:k", "m:mod-b:k");
const down = makeModuleRedis("mod-down", log, "redis://127.0.0.1:6399");
const t0 = Date.now(); let err = "";
try { await down.get("x"); } catch (e) { err = (e as Error).message; }
ok("Redis 不可用时命令 reject（不崩进程）", !!err, err.slice(0, 60));
ok("失败足够快（<10s）", Date.now() - t0 < 10000, `${Date.now() - t0}ms`);
ok("其他模块的连接不受影响", (await a.ping()) === "PONG");
for (const c of [a, b, down, raw]) c.disconnect();
console.log(bad ? `${bad} 项失败` : "全部通过"); process.exit(bad ? 1 : 0);
