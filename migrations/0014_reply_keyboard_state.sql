-- Persist the hidden Telegram message used to establish the Reply Keyboard.
-- This prevents /start/navigation from repeatedly creating keyboard anchors.
ALTER TABLE users ADD COLUMN reply_keyboard_message_id INTEGER;
