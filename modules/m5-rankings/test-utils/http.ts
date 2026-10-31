/**
 * TEST ONLY: renders errors like the base's global error handler ({ error: { code, message, module, requestId } }).
 * Lives in test-utils (never in module runtime code); uses only fastify + the base AppError.
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@app/core';

export function installTestErrorFormat(app: FastifyInstance): void {
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err instanceof AppError ? err.status : err.statusCode ?? 500;
    const module = /^\/api\/([^/]+)/.exec(req.url)?.[1];
    void reply.code(status).send({ error: { code: err.code ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
      message: status >= 500 && !(err instanceof AppError) ? '服务内部错误' : err.message, module, requestId: String(req.id) } });
  });
}
