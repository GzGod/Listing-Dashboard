// 生成 apps/web/src/generated/modules.tsx：把各模块 manifest 里声明的页面组件登记给前端外壳。
// 自动在 web 的 dev/build 前运行；生成文件不要手改、不提交。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverModules } from "../packages/core/src/loader.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "apps/web/src/generated/modules.tsx");
const recs = await discoverModules(path.join(root, "modules"), (process.env.DISABLED_MODULES ?? "").split(",").filter(Boolean));
const lines: string[] = [];
for (const r of recs) {
  if (r.status !== "loaded") { console.warn(`跳过 ${r.manifest.name}: ${r.error}`); continue; }
  const areas: Record<string, string[]> = {};
  for (const [area, items] of [["front", r.manifest.frontRoutes], ["admin", r.manifest.adminMenu]] as const)
    for (const it of items ?? []) if (it.component) {
      const rel = path.relative(path.dirname(outFile), path.join(r.dir, it.component)).replace(/\\/g, "/").replace(/\.tsx?$/, "");
      (areas[area] ??= []).push(`${JSON.stringify(it.path)}: React.lazy(() => import(${JSON.stringify(rel)}))`);
    }
  lines.push(`  ${JSON.stringify(r.manifest.name)}: { ${Object.entries(areas).map(([a, l]) => `${a}: { ${l.join(", ")} }`).join(", ")} },`);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `// 自动生成，勿手改（scripts/gen-web-registry.ts）\nimport React from "react";\nimport type { ModulePageProps } from "@app/ui";\nexport const modulePages: Record<string, Partial<Record<"front" | "admin", Record<string, React.ComponentType<ModulePageProps>>>>> = {\n${lines.join("\n")}\n};\n`);
console.log(`已生成 ${path.relative(root, outFile)}（${lines.length} 个模块）`);
