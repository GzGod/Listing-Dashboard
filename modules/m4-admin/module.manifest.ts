// M4 后台管理（AD-01 ~ AD-07）。只做录入/维护，不含计算逻辑。
import { defineModule } from "@app/core";
import { registerRoutes } from "./src/routes.js";
import { CONFIG, MODULE_NAME, PERMS, WRITE_ROLES, TABLES, EVENTS, OWN } from "./src/config.js";

const writes = [TABLES.projects, TABLES.contracts, TABLES.aliases, TABLES.listings, TABLES.tracks, TABLES.people, TABLES.personTags, TABLES.scoreParams, TABLES.kolTiers, TABLES.buzzAdjustments];
const page = (path: string, title: string, component: string) => ({ path, title, component, permission: PERMS.view });

export default defineModule({
  apiVersion: 1,
  name: MODULE_NAME,
  version: "0.1.0",
  displayName: "M4 后台管理",
  description: "AD-01~AD-07：项目与上币事件、人物池与标签、权重、调分、别名、确认队列、赛道与账号",
  requires: { core: "^1.1.0" },
  tables: {
    reads: ["projects", "project_contracts", "project_aliases", "listing_events", "exchanges", "platforms", "kol_tiers", "people", "person_tags", "tracks", "score_params", "buzz_snapshots", "users"],
    owns: [`m_m4_admin_${OWN.mockReview}`],
    writes,
  },
  apis: [
    { method: "GET", path: "/projects", description: "AD-01 项目列表" },
    { method: "POST", path: "/projects", permission: PERMS.write, description: "AD-01 新建项目（同 PUT/DELETE /projects/:id）" },
    { method: "POST", path: "/listings", permission: PERMS.write, description: "AD-01 上币事件 CRUD" },
    { method: "POST", path: "/people", permission: PERMS.write, description: "AD-02 人物池 CRUD；/person-tags 标签" },
    { method: "PUT", path: "/kol-tiers/:id", permission: PERMS.write, description: "AD-03 改 KOL 分级权重" },
    { method: "POST", path: "/backfill", permission: PERMS.write, description: "AD-03 手动回算 → recalc.requested(manual_backfill)" },
    { method: "POST", path: "/score-params", permission: PERMS.write, description: "AD-03 新权重版本 + recalc.requested(weights_changed)" },
    { method: "POST", path: "/adjustments", permission: PERMS.write, description: "AD-04 人工调分（写 buzz_adjustments）+ recalc.requested(manual_adjust)" },
    { method: "POST", path: "/aliases", permission: PERMS.write, description: "AD-05 别名 CRUD" },
    { method: "GET", path: "/review-queue", description: "AD-06 代理 M2 GET /review-queue" },
    { method: "POST", path: "/review/posts/:postId", permission: PERMS.write, description: "AD-06 代理 M2 POST /review/posts/:postId，body { projectIds: number[] }（勾选=确认，未勾选=驳回，空=该帖 pending 候选全部驳回）" },
    { method: "POST", path: "/tracks", permission: PERMS.write, description: "AD-07 赛道 CRUD" },
  ],
  config: CONFIG.map((c) => ({ ...c })),
  subscribes: [],
  emits: [EVENTS.recalc],
  permissions: [{ key: PERMS.write, description: "后台录入/维护", roles: [...WRITE_ROLES] }],
  adminMenu: [
    page("/projects", "AD-01 项目与上币", "web/ProjectsPage.tsx"),
    page("/people", "AD-02 人物池与标签", "web/PeoplePage.tsx"),
    page("/weights", "AD-03 权重配置", "web/WeightsPage.tsx"),
    page("/adjust", "AD-04 快照调分", "web/AdjustPage.tsx"),
    page("/aliases", "AD-05 别名维护", "web/AliasesPage.tsx"),
    page("/review", "AD-06 确认队列", "web/ReviewPage.tsx"),
    page("/tracks", "AD-07 赛道与账号", "web/TracksPage.tsx"),
  ],
  register: async (ctx) => {
    registerRoutes(ctx);
    // M2 不在线时的假数据（仅私有表）
    const [{ n }] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${ctx.db.t(OWN.mockReview)}`);
    if (!n) {
      await ctx.db.query(`INSERT INTO ${ctx.db.t(OWN.mockReview)} (mention_id, post_id, post_url, post_text, matched_alias, candidates) VALUES
      (9001, 9001, 'https://x.com/a/status/1', 'Loving $ONE today', 'ONE', '[{"projectId":1,"name":"Harmony","status":"pending"},{"projectId":2,"name":"OneFinity","status":"pending"}]'),
      (9002, 9002, 'https://x.com/b/status/2', 'APE season again', 'APE', '[{"projectId":3,"name":"ApeCoin","status":"pending"},{"projectId":4,"name":"Apecoin Classic","status":"pending"}]'),
      (9003, 9003, 'https://x.com/c/status/3', 'SOL ecosystem pump', 'SOL', '[{"projectId":1,"name":"Solana","status":"confirmed"},{"projectId":5,"name":"Solar","status":"rejected"}]') ON CONFLICT DO NOTHING`);
    await ctx.db.query(`UPDATE ${ctx.db.t(OWN.mockReview)} SET status = 'confirmed', decided_project_id = 1, decided_project_ids = ARRAY[1] WHERE mention_id = 9003`);
    }
  },
});
