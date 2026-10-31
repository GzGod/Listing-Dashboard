// M2 匹配与清洗：把帖子匹配到项目（名称/ticker/合约/别名），重名或低置信进人工确认队列（M4 AD-06 调用）。
import { defineModule } from "@app/core";
import { registerRoutes, PERMS } from "./src/routes.js";
import { matchPosts } from "./src/service.js";
import { CONFIG_SPEC, MODULE_NAME } from "./src/config.js";

export default defineModule({
  apiVersion: 1,
  name: MODULE_NAME,
  version: "0.1.0",
  displayName: "M2 匹配与清洗",
  requires: { core: "^1.1.0" },
  tables: {
    reads: ["posts", "projects", "project_contracts", "project_aliases"],
    writes: ["post_mentions"],
    owns: [],
  },
  apis: [
    { method: "GET", path: "/review-queue", description: "待确认列表（M4 AD-06 调）" },
    { method: "POST", path: "/review/posts/:postId", permission: PERMS.review, description: "按帖审核 {projectIds:number[]}（[]=全部驳回），发 recalc.requested(mention_changed)" },
    { method: "POST", path: "/rematch", permission: PERMS.review, description: "手动重匹配 {postIds}" },
  ],
  subscribes: ["post.ingested"],
  emits: ["recalc.requested"],
  permissions: [{ key: PERMS.review, description: "处理确认队列", roles: ["admin", "editor"] }],
  config: CONFIG_SPEC,
  register: async (ctx) => {
    registerRoutes(ctx);
    ctx.events.on("post.ingested", async (p) => { const r = await matchPosts(ctx, p.postIds); ctx.log.info("匹配完成", r); });
  },
});
