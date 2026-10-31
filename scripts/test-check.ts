// pnpm test:check —— pnpm check 的 --dir / --module 结论一致，且类型检查真的覆盖后端和 web/（含 next/link、next/navigation）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0; const ok = (n: string, c: boolean, d = "") => { if (!c) bad++; console.log(`${c ? "✅" : "❌"} ${n} ${d}`); };
const check = (...a: string[]) => { try { return { code: 0, out: execFileSync("npx", ["tsx", "scripts/check-modules.ts", ...a], { cwd: root, encoding: "utf8", stdio: "pipe" }) }; } catch (e: any) { return { code: e.status as number, out: String(e.stdout) + String(e.stderr) }; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chk-"));
const good = path.join(tmp, "chk-good");
fs.cpSync(path.join(root, "modules/example"), good, { recursive: true, filter: (f) => !f.includes("node_modules") });
const renameAll = (d: string, from: string, to: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true, recursive: true })) { if (!e.isFile()) continue; const p = path.join(e.parentPath, e.name);
  const t = fs.readFileSync(p, "utf8"); fs.writeFileSync(p, t.replaceAll(`m_${from.replace(/-/g, "_")}_`, `m_${to.replace(/-/g, "_")}_`).replaceAll(`"${from}"`, `"${to}"`).replaceAll(`"${from}.`, `"${to}.`).replaceAll(`${from}:`, `${to}:`)); } };
renameAll(good, "example", "chk-good");
// 仓库外、没有 node_modules 的模块（含 next/link、next/navigation 的 web 文件）
for (const a of [["--dir", good], ["--module", good]]) { const r = check(...a); ok(`好模块 ${a[0]} 通过`, r.code === 0, r.code ? r.out.slice(0, 300) : ""); }
const badMod = path.join(tmp, "chk-bad"); fs.cpSync(good, badMod, { recursive: true });
renameAll(badMod, "chk-good", "chk-bad");
fs.writeFileSync(path.join(badMod, "web", "Bad.tsx"), 'import Link from "next/link";\nexport default function Bad() { const n: number = "x"; return <Link href="/">{n}</Link>; }\n');
fs.mkdirSync(path.join(badMod, "server"), { recursive: true });
fs.writeFileSync(path.join(badMod, "server", "bad.ts"), "export const s: string = 1;\n");
for (const a of [["--dir", badMod], ["--module", badMod]]) {
  const r = check(...a);
  ok(`坏模块 ${a[0]} 失败`, r.code !== 0);
  ok(`  ${a[0]} 报出 web/ 类型错误`, /类型检查\(前端\).*web\/Bad\.tsx/.test(r.out));
  ok(`  ${a[0]} 报出 server/ 类型错误`, /类型检查\(后端\).*server\/bad\.ts/.test(r.out));
}
{ const r = check("--dir", badMod, "--no-typecheck"); ok("--no-typecheck 只跑静态规则（坏类型也通过）", r.code === 0, r.code ? r.out.slice(0, 200) : ""); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `${bad} 项失败` : "全部通过"); process.exit(bad ? 1 : 0);
