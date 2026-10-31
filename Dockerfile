# 一个镜像跑 server / worker / web / migrate（命令不同）
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app
COPY . .
ARG API_URL=http://server:4000
ENV API_URL=$API_URL
RUN pnpm install --frozen-lockfile && pnpm db:generate && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @app/web build
ENV NODE_ENV=production
