-- VayroAI UI/dialog/image pricing hardening.
ALTER TABLE chats ADD COLUMN archive_expires_at TEXT;

INSERT INTO settings(key,value,updated_at) VALUES
('active_chat_limit','5',datetime('now')),
('archive_chat_limit','15',datetime('now')),
('home_banner_file_id','',datetime('now')),
('image_quality_price_low','1',datetime('now')),
('image_quality_price_standard','2',datetime('now')),
('image_quality_price_medium','2',datetime('now')),
('image_quality_price_high','3',datetime('now')),
('image_quality_price_hd','3',datetime('now')),
('image_quality_price_ultra','5',datetime('now'))
ON CONFLICT(key) DO NOTHING;
