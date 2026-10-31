// pnpm check                       校验仓库 modules/ 下全部模块
// pnpm check --dir <目录>           目录本身有 module.manifest.* 就当单个模块，否则校验它下面每个子目录
// pnpm check --module <模块目录>    单个模块（可在仓库外、没有自己的 node_modules），和仓库已有模块一起查依赖/键冲突
// 默认都会做类型检查（后端 NodeNext + web/ 用 Next.js 口径），加 --no-typecheck 只跑静态规则
// 合并同事模块前先跑。校验 manifest、底座版本、依赖、表前缀、迁移只动自有表、tables.writes 归属、配置键前缀，
// 并扫描模块源码里禁止的原生 SQL（$queryRawUnsafe / $executeRaw* / 直接 import @prisma/client 或 @app/db）。不连数据库。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { discoverModules, resolveOrder, type ModuleRecord } from "@app/core";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = arg("--dir"), one = arg("--module");
const hasManifest = (d: string) => fs.existsSync(path.join(d, "module.manifest.ts")) || fs.existsSync(path.join(d, "module.manifest.json"));
/** 仓库外的模块没有自己的 node_modules，import @app/core 会失败：拷一份到仓库内的临时目录（只读原目录），从底座 workspace 解析依赖 */
const STAGE = path.join(root, ".check-staging");
function stage(abs: string): string {
  if (abs.startsWith(root + path.sep)) return abs;
  const dst = path.join(STAGE, path.basename(abs));
  fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(STAGE, { recursive: true });
  // 让临时目录里的 import 能找到 react / @app/ui（web 壳已装好）
  const nm = path.join(STAGE, "node_modules"); if (!fs.existsSync(nm)) fs.symlinkSync(path.join(root, "apps/web/node_modules"), nm, "dir");
  fs.cpSync(abs, dst, { recursive: true, filter: (f) => !/(^|\/)(node_modules|\.git|\.next)(\/|$)/.test(path.relative(abs, f)) });
  return dst;
}
const displayDir = new Map<string, string>();
const doTypecheck = !process.argv.includes("--no-typecheck");
const tcDirs = new Set<string>();
let recs: ModuleRecord[];
const target = one ?? (dir && hasManifest(path.resolve(dir)) ? dir : undefined);
if (target) {
  // 单个模块：和仓库里已有模块一起校验（查依赖、键冲突），但只报告它自己
  const orig = path.resolve(target);
  if (!hasManifest(orig)) { console.error(`${orig} 里没有 module.manifest.ts / module.manifest.json`); process.exit(1); }
  const abs = stage(orig); displayDir.set(abs, orig);
  const mine = (await discoverModules(path.dirname(abs))).filter((r) => path.resolve(r.dir) === abs);
  const base = (await discoverModules(path.join(root, "modules"))).filter((r) => r.manifest.name !== mine[0].manifest.name);
  recs = resolveOrder([...base, ...mine]).filter((r) => mine.includes(r));
} else {
  // 多模块目录：仓库外的先整体拷到临时目录，再逐个检查
  const d0 = path.resolve(dir ?? path.join(root, "modules"));
  let d1 = d0;
  if (!d0.startsWith(root + path.sep)) {
    d1 = path.join(STAGE, "_dir"); fs.rmSync(d1, { recursive: true, force: true }); fs.mkdirSync(STAGE, { recursive: true });
    const nm = path.join(STAGE, "node_modules"); if (!fs.existsSync(nm)) fs.symlinkSync(path.join(root, "apps/web/node_modules"), nm, "dir");
    fs.cpSync(d0, d1, { recursive: true, filter: (f) => !/(^|\/)(node_modules|\.git|\.next)(\/|$)/.test(path.relative(d0, f)) });
  }
  recs = resolveOrder(await discoverModules(d1));
  for (const r of recs) displayDir.set(path.resolve(r.dir), path.join(d0, path.relative(d1, r.dir)));
}
// 默认都做类型检查（--dir 和 --module 结论一致）；--no-typecheck 只跑静态规则。外部服务模块（json manifest、非 TS）跳过
if (doTypecheck) for (const r of recs) if (fs.existsSync(path.join(r.dir, "module.manifest.ts"))) tcDirs.add(path.resolve(r.dir));

const FORBIDDEN: [RegExp, string][] = [
  [/\$queryRawUnsafe\b/, "禁止 $queryRawUnsafe（只读查询用模板字符串 $queryRaw）"],
  [/\$executeRaw(Unsafe)?\b/, "禁止 $executeRaw / $executeRawUnsafe（写自有表用 ctx.db.query，写核心表用 Prisma 模型方法）"],
  [/from\s+["'](@prisma\/client|@app\/db)["']/, "禁止直接 import @prisma/client / @app/db（用 ctx.db）"],
  [/\$queryRaw\s*\(\s*["'`]/, "$queryRaw 不能传拼好的字符串（用 $queryRaw`...` 或 $queryRaw(sql`...`)）"],
  [/from\s+["'](ioredis|redis)["']|require\(["'](ioredis|redis)["']\)/, "模块不能自己建 Redis 连接，用 ctx.redis"],
  [/REDIS_URL/, "模块不能读 REDIS_URL 自建连接，用 ctx.redis"],
  [/from\s+["']pg["']|require\(["']pg["']\)/, "模块运行时代码不能直接用 pg（用 ctx.db）；只有测试文件可以"],
  [/Prisma\.raw\b/, "禁止 Prisma.raw（绕过参数绑定）"],
];
const scan = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? scan(path.join(d, e.name)) : /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) ? [path.join(d, e.name)] : []);
let bad = 0;
for (const r of recs) {
  const problems = r.status === "loaded" ? [] : [r.error ?? r.status];
  for (const f of scan(r.dir)) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    const isTest = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(test|tests|__tests__)\//.test(path.relative(r.dir, f));
    lines.forEach((l, i) => { for (const [re, msg] of FORBIDDEN) if (re.test(l) && !(isTest && msg.includes(" pg"))) problems.push(`${path.relative(r.dir, f)}:${i + 1} ${msg}`); });
  }
  if (tcDirs.has(path.resolve(r.dir))) problems.push(...runTsc(path.resolve(r.dir)));
  if (problems.length) bad++;
  console.log(`${problems.length ? "FAIL" : "OK  "} ${r.manifest.name}@${r.manifest.version} (${r.manifest.kind ?? "internal"})  ${displayDir.get(path.resolve(r.dir)) ?? path.relative(process.cwd(), r.dir)}`);
  for (const p of problems) console.log(`       <- ${p}`);
}
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
console.log(bad ? `\n${bad} 个模块有问题` : `\n全部 ${recs.length} 个模块通过`);
process.exit(bad ? 1 : 0);

/** 类型检查：后端/共享代码用 tsconfig.module.json（NodeNext），web/ 用 tsconfig.module.web.json（Next.js 口径：bundler、jsx preserve、next/* 类型）。
 *  依赖都从底座 workspace 解析，不需要模块自己装 node_modules。 */
function runTsc(d: string): string[] {
  const out: string[] = [];
  const passes: [string, object][] = [
    ["后端", { extends: path.join(root, "tsconfig.module.json"), compilerOptions: { baseUrl: root, typeRoots: [path.join(root, "node_modules/@types")], paths: {
      "@app/core": ["packages/core/src/index.ts"], "@app/shared": ["packages/shared/src/index.ts"], "@app/ui": ["packages/ui/src/index.tsx"], "@app/db": ["packages/db/src/index.ts"],
      "react": ["apps/web/node_modules/@types/react/index.d.ts"], "react/*": ["apps/web/node_modules/@types/react/*"],
      "*": ["packages/core/node_modules/*", "packages/core/node_modules/@types/*", "apps/web/node_modules/*", "node_modules/*"] } },
      include: ["module.manifest.ts", "**/*.ts", "**/*.tsx"], exclude: ["node_modules", ".next", "dist", "web/**"] }],
    ["前端", { extends: path.join(root, "tsconfig.module.web.json"), include: [path.join(root, "apps/web/next-env.d.ts"), "web/**/*.ts", "web/**/*.tsx"], exclude: ["node_modules"] }],
  ];
  for (const [label, cfgObj] of passes) {
    if (label === "前端" && !fs.existsSync(path.join(d, "web"))) continue;
    const cfg = path.join(d, `tsconfig.check-${label === "前端" ? "web" : "server"}.json`);
    fs.writeFileSync(cfg, JSON.stringify(cfgObj));
    try { execFileSync(path.join(root, "node_modules/.bin/tsc"), ["-p", cfg, "--noEmit"], { cwd: d, stdio: "pipe" }); }
    catch (e: any) { out.push(...String(e.stdout ?? e.message).trim().split("\n").filter(Boolean).slice(0, 30).map((l) => `类型检查(${label}): ` + l.replace(d + "/", ""))); }
    finally { fs.rmSync(cfg, { force: true }); }
  }
  return out;
}
