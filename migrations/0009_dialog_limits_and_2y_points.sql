-- Dialog message limits and the 2-year subscription daily-point tier.

INSERT INTO settings(key,value,updated_at) VALUES
('chat_message_limit_free','50',datetime('now')),
('chat_message_limit_subscriber','100',datetime('now')),
('chat_message_limit_2y','200',datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;

UPDATE settings
SET value='4096', updated_at=datetime('now')
WHERE key='user_message_max_chars';

UPDATE plans
SET points=200
WHERE plan_key='sub-2y'
  AND kind='subscription';
