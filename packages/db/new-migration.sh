#!/bin/sh
# 新建核心表迁移：pnpm --filter @app/db migrate:new <名字>
# 不用 `prisma migrate dev`：同一个库里有模块自有表 m_*，migrate dev 会把它们当成漂移要求重置数据库。
# 这里用迁移历史在影子库(SHADOW_DATABASE_URL)里重放，再和 schema.prisma 做 diff，只生成核心表的变更。
set -e
NAME=${1:?用法: migrate:new <名字>}
SHADOW=${SHADOW_DATABASE_URL:?需要 SHADOW_DATABASE_URL（一个空库，例如 postgresql://postgres:postgres@localhost:5432/dashboard_shadow）}
DIR=prisma/migrations/$(date -u +%Y%m%d%H%M%S)_$NAME
mkdir -p "$DIR"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW" --script > "$DIR/migration.sql"
echo "注意：如果生成的 SQL 里有 DROP INDEX \"buzz_adjustments_active_uq\"，删掉那一行（这是手写的部分唯一索引，Prisma 不认识）"
echo "已生成 $DIR/migration.sql，检查后执行 pnpm db:migrate"
