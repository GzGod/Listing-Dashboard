-- 未获取到的社交指标不能当成 0。已有值保留，后续采集缺失写 NULL。
ALTER TABLE posts ALTER COLUMN views DROP NOT NULL;
ALTER TABLE posts ALTER COLUMN views DROP DEFAULT;
ALTER TABLE posts ALTER COLUMN bookmarks DROP NOT NULL;
ALTER TABLE posts ALTER COLUMN bookmarks DROP DEFAULT;
CREATE INDEX posts_refetch_idx ON posts (platform_id, frozen, posted_at);
ALTER TABLE volume_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE volume_snapshots ADD COLUMN fetched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
