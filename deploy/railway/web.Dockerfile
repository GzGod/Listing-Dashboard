FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
# Next 的 rewrites 在构建时写进 routes-manifest，所以 API_URL 构建和运行都要给
ARG API_URL=http://localhost:4000
ARG NEXT_PUBLIC_AUTH_DISABLED=0
ENV NEXT_PUBLIC_AUTH_DISABLED=$NEXT_PUBLIC_AUTH_DISABLED
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @app/web build
ENV NODE_ENV=production
CMD ["sh", "-c", "cd apps/web && exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
