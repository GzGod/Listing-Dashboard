-- M4 私有表（前缀 m_m4_admin_，底座按模块名 m4-admin 推导）。M2 不在线时的确认队列假数据。
CREATE TABLE IF NOT EXISTS m_m4_admin_mock_review (
  mention_id INT PRIMARY KEY,
  post_url TEXT, post_text TEXT, matched_alias TEXT,
  candidates JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_project_id INT, decided_by INT, decided_at TIMESTAMPTZ
);
