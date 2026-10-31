-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "exchanges" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platforms" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kol_tiers" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kol_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_params" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by" INTEGER,
    "a" DOUBLE PRECISION NOT NULL,
    "b" DOUBLE PRECISION NOT NULL,
    "update_frequency" TEXT NOT NULL DEFAULT 'daily',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" INTEGER,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "track_id" INTEGER,
    "fundamentals" JSONB,
    "team" JSONB,
    "logo_url" TEXT,
    "website_url" TEXT,
    "x_handle" TEXT,
    "docs_url" TEXT,
    "users_count" INTEGER,
    "users_as_of" DATE,
    "users_source" TEXT,
    "revenue_usd" DECIMAL(20,2),
    "revenue_period" TEXT,
    "revenue_as_of" DATE,
    "revenue_source" TEXT,
    "coingecko_id" TEXT,
    "longge_rating" TEXT,
    "longge_rated_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_contracts" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "project_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_aliases" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "project_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_events" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "exchange_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "stage" TEXT NOT NULL,
    "pair" TEXT,
    "announcement_url" TEXT,

    CONSTRAINT "listing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" SERIAL NOT NULL,
    "display_name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "platform_id" INTEGER NOT NULL,
    "kol_tier" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "joined_pool_at" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_tags" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "person_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "platform_id" INTEGER NOT NULL,
    "platform_post_id" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT NOT NULL,
    "text" TEXT,
    "last_fetched_at" TIMESTAMP(3),
    "frozen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_mentions" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "match_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "post_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzz_snapshots" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "track_id" INTEGER,
    "kol_post_count" INTEGER,
    "core_exposure_count" INTEGER,
    "heat_score" DOUBLE PRECISION,
    "params_version" TEXT,
    "tiers_version" TEXT,
    "raw_total" DOUBLE PRECISION,
    "track_rank" INTEGER,
    "adjusted_total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "buzz_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buzz_adjustments" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "buzz_snapshot_id" INTEGER,
    "value" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "buzz_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "price_usd" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'coingecko',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volume_snapshots" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "exchange_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "spot_volume_usd_24h" DOUBLE PRECISION,

    CONSTRAINT "volume_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_daily" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "track_id" INTEGER,
    "total_spot_volume_usd" DOUBLE PRECISION,
    "volume_track_rank" INTEGER,
    "price_usd" DOUBLE PRECISION,

    CONSTRAINT "project_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" INTEGER,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "table_name" TEXT,
    "record_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_module_migrations" (
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_module_migrations_pkey" PRIMARY KEY ("module","name")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_name_key" ON "exchanges"("name");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_name_key" ON "platforms"("name");

-- CreateIndex
CREATE INDEX "kol_tiers_effective_from_idx" ON "kol_tiers"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "kol_tiers_version_name_key" ON "kol_tiers"("version", "name");

-- CreateIndex
CREATE UNIQUE INDEX "score_params_version_key" ON "score_params"("version");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_parent_id_name_key" ON "tracks"("parent_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_coingecko_id_key" ON "projects"("coingecko_id");

-- CreateIndex
CREATE INDEX "projects_symbol_idx" ON "projects"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "project_contracts_chain_address_key" ON "project_contracts"("chain", "address");

-- CreateIndex
CREATE INDEX "project_aliases_alias_idx" ON "project_aliases"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "project_aliases_project_id_alias_key" ON "project_aliases"("project_id", "alias");

-- CreateIndex
CREATE INDEX "listing_events_day_idx" ON "listing_events"("day");

-- CreateIndex
CREATE UNIQUE INDEX "people_platform_id_handle_key" ON "people"("platform_id", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "person_tags_person_id_tag_key" ON "person_tags"("person_id", "tag");

-- CreateIndex
CREATE INDEX "posts_posted_at_idx" ON "posts"("posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "posts_platform_id_platform_post_id_key" ON "posts"("platform_id", "platform_post_id");

-- CreateIndex
CREATE INDEX "post_mentions_status_idx" ON "post_mentions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "post_mentions_post_id_project_id_key" ON "post_mentions"("post_id", "project_id");

-- CreateIndex
CREATE INDEX "buzz_snapshots_day_track_id_idx" ON "buzz_snapshots"("day", "track_id");

-- CreateIndex
CREATE UNIQUE INDEX "buzz_snapshots_project_id_day_key" ON "buzz_snapshots"("project_id", "day");

-- CreateIndex
CREATE INDEX "buzz_adjustments_project_id_day_idx" ON "buzz_adjustments"("project_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "price_snapshots_project_id_day_key" ON "price_snapshots"("project_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "volume_snapshots_project_id_exchange_id_day_key" ON "volume_snapshots"("project_id", "exchange_id", "day");

-- CreateIndex
CREATE INDEX "project_daily_day_track_id_idx" ON "project_daily"("day", "track_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_daily_project_id_day_key" ON "project_daily"("project_id", "day");

-- CreateIndex
CREATE INDEX "audit_logs_table_name_record_id_idx" ON "audit_logs"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_snapshots" ADD CONSTRAINT "buzz_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_snapshots" ADD CONSTRAINT "buzz_snapshots_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_adjustments" ADD CONSTRAINT "buzz_adjustments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buzz_adjustments" ADD CONSTRAINT "buzz_adjustments_buzz_snapshot_id_fkey" FOREIGN KEY ("buzz_snapshot_id") REFERENCES "buzz_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volume_snapshots" ADD CONSTRAINT "volume_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volume_snapshots" ADD CONSTRAINT "volume_snapshots_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_daily" ADD CONSTRAINT "project_daily_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_daily" ADD CONSTRAINT "project_daily_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 每个项目每天最多一条未撤销的人工调分（Prisma 不支持部分唯一索引，手写）
CREATE UNIQUE INDEX "buzz_adjustments_active_uq" ON "buzz_adjustments"("project_id", "day") WHERE "revoked" = false;
