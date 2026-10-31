-- M1 私有表（前缀 m_m1_collector_）。币价写核心表 price_snapshots，不再有私有价格表。
CREATE TABLE IF NOT EXISTS m_m1_collector_cursors (
  person_id INT PRIMARY KEY, since_id TEXT, last_run_at TIMESTAMPTZ
);
-- 运行记录：每日行情是否已拉齐（market.snapshot.ingested 只发一次）、X 每日调用计数
CREATE TABLE IF NOT EXISTS m_m1_collector_runs (
  kind TEXT NOT NULL, day DATE NOT NULL, count INT NOT NULL DEFAULT 0, done BOOLEAN NOT NULL DEFAULT false, detail JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, day)
)
