FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate
ENV NODE_ENV=production HOST=0.0.0.0
CMD ["sh", "deploy/railway/start-server.sh"]
