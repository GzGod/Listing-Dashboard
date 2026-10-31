import type { FastifyInstance } from "fastify";
import type { ApiError } from "@app/shared";
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
/** 统一错误格式 { error: { code, message, module, requestId } }；模块抛错不会拖垮进程 */
export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: any, req, reply) => {
    const status = err instanceof AppError ? err.status : err.statusCode ?? 500;
    const mod = /^\/api\/([^/]+)/.exec(req.url)?.[1];
    if (status >= 500) req.log.error({ err, module: mod }, "request failed");
    const body: ApiError = { error: { code: err.code ?? (status >= 500 ? "INTERNAL" : "BAD_REQUEST"), message: status >= 500 && !(err instanceof AppError) ? "服务内部错误" : err.message, module: mod, requestId: String(req.id) } };
    reply.code(status).send(body);
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: `接口不存在: ${req.method} ${req.url}`, requestId: String(req.id) } }));
}
