-- Persist the normal chat state while the dedicated Search Mode is active.
-- This keeps Search Mode isolated from the user's regular chat model/settings.
ALTER TABLE users ADD COLUMN previous_chat_model_key TEXT;
ALTER TABLE users ADD COLUMN previous_chat_web_search_state INTEGER NOT NULL DEFAULT 0;
