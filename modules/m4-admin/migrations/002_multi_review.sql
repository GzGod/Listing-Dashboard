-- 确认队列改多选：记录本组确认的项目 id 列表（候选逐个状态写在 candidates JSON 的 status 字段）
ALTER TABLE m_m4_admin_mock_review ADD COLUMN IF NOT EXISTS decided_project_ids INT[]
