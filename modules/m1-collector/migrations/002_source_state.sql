ALTER TABLE m_m1_collector_cursors ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE m_m1_collector_cursors ADD COLUMN IF NOT EXISTS page_token TEXT;
ALTER TABLE m_m1_collector_cursors ADD COLUMN IF NOT EXISTS newest_id TEXT;
ALTER TABLE m_m1_collector_cursors ADD COLUMN IF NOT EXISTS platform_user_id TEXT;
DELETE FROM m_m1_collector_cursors WHERE person_id NOT IN (SELECT id FROM people);
ALTER TABLE m_m1_collector_cursors ADD CONSTRAINT m_m1_collector_cursors_person_fk FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS m_m1_collector_locks (
  name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS m_m1_collector_source_rates (
  name TEXT PRIMARY KEY, next_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS m_m1_collector_outbox (
  id BIGSERIAL PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, event TEXT NOT NULL,
  payload JSONB NOT NULL, revision INT NOT NULL DEFAULT 1, sent BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS m_m1_collector_outbox_pending ON m_m1_collector_outbox (id) WHERE sent = false;
-- 明确的交易所资产身份；同一个交易所资产不能归属两个项目。
CREATE TABLE IF NOT EXISTS m_m1_collector_market_assets (
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  exchange_id INT NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  base_symbol TEXT NOT NULL, note TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, exchange_id), UNIQUE (exchange_id, base_symbol)
);
