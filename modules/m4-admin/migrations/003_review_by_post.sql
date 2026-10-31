-- M2 改为按帖子提交：假数据每行就是一个帖子组，补 post_id（与原 mention_id 一一对应）
ALTER TABLE m_m4_admin_mock_review ADD COLUMN IF NOT EXISTS post_id INT;
UPDATE m_m4_admin_mock_review SET post_id = mention_id WHERE post_id IS NULL
