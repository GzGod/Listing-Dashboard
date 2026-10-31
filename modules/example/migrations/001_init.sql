CREATE TABLE IF NOT EXISTS m_example_notes (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
