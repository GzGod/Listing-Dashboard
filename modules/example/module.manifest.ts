// 示例模块（代码内模块）：演示路由、自有表读写、发/收事件、定时任务、后台菜单、前台页面、权限、审计。
import { defineModule } from "@app/core";
import { registerRoutes } from "./src/routes.js";

export default defineModule({
  apiVersion: 1,
  name: "example",
  version: "1.0.0",
  displayName: "示例模块",
  requires: { core: "^1.1.0" },
  tables: { reads: ["projects"], writes: [], owns: ["m_example_notes"] },
  apis: [
    { method: "GET", path: "/notes", description: "列出笔记" },
    { method: "POST", path: "/notes", permission: "example:write", description: "新增笔记（写审计日志）" },
    { method: "POST", path: "/emit", permission: "example:write", description: "发一个 recalc.requested 事件" },
  ],
  subscribes: ["post.ingested", "daily.batch.done"],
  emits: ["recalc.requested"],
  permissions: [{ key: "example:write", description: "写示例笔记", roles: ["admin", "editor"] }],
  adminMenu: [{ path: "/", title: "示例模块", component: "web/AdminPage.tsx", permission: "admin:access" }],
  frontRoutes: [
    { path: "/", title: "示例页面", component: "web/FrontPage.tsx" },
    { path: "/notes/:id", title: "笔记详情", component: "web/NoteDetail.tsx", hidden: true }, // 动态路由 + 不进菜单示例
  ],
  config: [ // 本模块配置键（必须 example. 开头）
    { key: "example.heartbeatCron", default: "0 * * * *", description: "心跳任务 cron" },
    { key: "example.pageSize", default: 50, description: "笔记列表条数", public: true },
  ],
  jobs: [{
    name: "heartbeat", cronKey: "example.heartbeatCron", // cron 从配置中心读，默认值见上面 config
    run: async (ctx) => { await ctx.db.query(`INSERT INTO ${ctx.db.t("notes")} (text, source) VALUES ($1, 'job')`, `heartbeat ${new Date().toISOString()}`); },
  }],
  register: async (ctx) => {
    registerRoutes(ctx);
    // 收事件：处理函数在 worker 进程里执行，抛错会自动重试
    ctx.events.on("post.ingested", async (p, meta) => {
      await ctx.db.query(`INSERT INTO ${ctx.db.t("notes")} (text, source) VALUES ($1, 'event')`, `收到 ${meta.event}（来自 ${meta.from}）postIds=${p.postIds.join(",")}`);
    });
    ctx.events.on("daily.batch.done", async (p) => { ctx.log.info(`日批完成 ${p.dateFrom}~${p.dateTo}`); });
  },
});
