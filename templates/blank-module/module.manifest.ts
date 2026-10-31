// 空白模块模板。复制方式：pnpm module:new <模块名>（会自动替换 __NAME__ / __TABLE__ 占位）
import { defineModule } from "@app/core";
import { registerRoutes } from "./src/routes.js";

export default defineModule({
  apiVersion: 1,
  name: "__NAME__",
  version: "0.1.0",
  displayName: "__NAME__",
  requires: { core: "^1.1.0" },
  tables: { reads: [], writes: [], owns: ["m___TABLE___items"] }, // writes：要写的核心表/列，必须在 ownership.ts 里归本模块
  apis: [{ method: "GET", path: "/items" }, { method: "POST", path: "/items", permission: "__NAME__:write" }],
  subscribes: [],          // 例如 ["post.ingested"]，并在 register 里 ctx.events.on(...)
  emits: [],
  permissions: [{ key: "__NAME__:write", roles: ["admin", "editor"] }],
  adminMenu: [{ path: "/", title: "__NAME__", component: "web/AdminPage.tsx", permission: "admin:access" }],
  frontRoutes: [],
  config: [],              // 本模块配置键，必须 "__NAME__." 开头，例如 [{ key: "__NAME__.dailyCron", default: "5 0 * * *", description: "…", public: false }]
  jobs: [],                // 例如 [{ name: "daily", cronKey: "__NAME__.dailyCron", run: async (ctx) => {} }]
  register: async (ctx) => { registerRoutes(ctx); },
});
