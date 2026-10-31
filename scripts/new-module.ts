// pnpm module:new <name>  —— 从 templates/blank-module 复制出一个新模块（不改任何底座代码）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function createModule(name: string, modulesDir = path.join(root, "modules")) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("模块名只能是小写字母开头的小写字母/数字/短横线");
  const dst = path.join(modulesDir, name);
  if (fs.existsSync(dst)) throw new Error(`${dst} 已存在`);
  const copy = (src: string, to: string) => {
    for (const f of fs.readdirSync(src)) {
      const s = path.join(src, f), d = path.join(to, f);
      if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d); }
      else fs.writeFileSync(d, fs.readFileSync(s, "utf8").replaceAll("__NAME__", name).replaceAll("__TABLE__", name.replace(/-/g, "_")));
    }
  };
  fs.mkdirSync(dst, { recursive: true }); copy(path.join(root, "templates/blank-module"), dst);
  return dst;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const name = process.argv[2]; if (!name) { console.error("用法: pnpm module:new <name>"); process.exit(1); }
  console.log(`已创建 ${createModule(name)}。接着运行 pnpm install（让新模块拿到 @app/core 等依赖），然后重启 server/worker。`);
}
