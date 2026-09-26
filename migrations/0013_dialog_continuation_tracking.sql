-- Track the last real continuation separately from generic chat edits.
ALTER TABLE chats ADD COLUMN last_continued_at TEXT;

-- Existing chats inherit their current activity timestamp once.
UPDATE chats
SET last_continued_at=updated_at
WHERE last_continued_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chats_user_archived_continued
  ON chats(user_id,is_archived,last_continued_at);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created_id
  ON messages(chat_id,created_at,id);
