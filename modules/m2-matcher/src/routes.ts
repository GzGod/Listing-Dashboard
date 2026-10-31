import type { ModuleContext } from "@app/core";
import { AppError } from "@app/core";
import { matchPosts, resolvePost, reviewQueue } from "./service.js";
export const PERMS = { review: "m2-matcher:review" } as const;
export function registerRoutes(ctx: ModuleContext) {
  ctx.router.get("/review-queue", async (req) => reviewQueue(ctx, Number((req.query as any)?.limit) || undefined));
  ctx.router.post("/review/posts/:postId", { preHandler: ctx.requirePermission(PERMS.review) }, async (req) => {
    const id = Number((req.params as any).postId); if (!Number.isInteger(id)) throw new AppError(400, "BAD_INPUT", "postId 不合法");
    return resolvePost(ctx, id, (req.body as any) ?? {}, req.user?.id ?? null);
  });
  ctx.router.post("/rematch", { preHandler: ctx.requirePermission(PERMS.review) }, async (req) => matchPosts(ctx, ((req.body as any)?.postIds ?? []).map(Number)));
}
